import { config } from '../config/alpaca.js';
import type { Database } from '../db/database.js';
import type { AlpacaAccount, AlpacaOrder, AlpacaPosition, BotConfig, BotLog, BotStatus, StockSentiment } from '../types/alpaca.js';

import { alpacaService } from './alpacaService.js';
import {
  BUY_COOLDOWN_MS,
  CASH_EQUIVALENT_TICKERS,
  DAILY_LOSS_LIMIT,
  INDEX_ACCUMULATION_TICKERS,
  INDEX_CASH_MIN_PCT,
  INDEX_COOLDOWN_MS,
  IS_DISABLE_CRYPTO_BUYS,
  MEME_PROFIT_SHARE,
  PositionRiskContext,
  PositionSnapshot,
  REGIME_SMA_PERIOD,
  RISK_CHECK_SECONDS,
  RISK_ON_SLEEVE_ENABLED,
  SLEEVE_FLATTEN_ON_BREACH,
  TECH_MIN_CONFIDENCE,
  TECH_SELL_MIN_CONFIDENCE,
  TBILL_ALLOCATION_PCT,
  TBILL_BUY_PCT,
  TBILL_CASH_MIN_PCT,
  VOLATILE_ATR_PCT,
  matchKey,
} from './botConfig.js';
import { BotManager } from './botManager.js';
import { evaluateHighBetaExposure, isHighBeta } from './exposureGuard.js';
import { Logger } from './logger.js';
import { MarketClock } from './marketClock.js';
import { newsService } from './newsService.js';
import { portfolioService } from './portfolioService.js';
import { marketRegimeService } from './regimeService.js';
import { TechnicalSignal, technicalService } from './technicalService.js';

interface StrategyContext {
  account: AlpacaAccount;
  positionMap: Record<string, AlpacaPosition>;
  pendingBuyOrdersMap: Record<string, AlpacaOrder>;
  openOrders: AlpacaOrder[];
  activeWatchlist: string[];
  memeBudget: number;
}

interface TechnicalBuyOutcome {
  control: 'break' | 'continue' | 'none';
  techBuysThisCycle: number;
  memeSpentThisCycle: number;
}

const MAX_TECH_BUYS_PER_CYCLE = 1;

export class BotEngine {
  public assetClass: 'crypto' | 'us_equity';
  public isRunning = false;
  public riskInterval: NodeJS.Timeout | null = null;
  public strategyInterval: NodeJS.Timeout | null = null;
  public botLogs: BotLog[] = [];
  public riskTick = 0;

  public highWaterMarkMap: Record<string, number> = {};
  public peakStallCountMap: Record<string, number> = {};
  public scaledOutMap: Record<string, boolean> = {};
  public lastBuyTimeMap: Record<string, number> = {};
  public lastSellTimeMap: Record<string, number> = {};

  private readonly REENTRY_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours
  private lastPreOpenSweepDate: string | null = null;

  public currentConfig: BotConfig;
  private readonly defaultRiskParams: { stopLossPercent: number; takeProfitPercent: number; trailingStopPercent: number };

  constructor(
    assetClass: 'crypto' | 'us_equity',
    defaultConfig: BotConfig,
    private readonly database: Database,
  ) {
    this.assetClass = assetClass;
    this.currentConfig = { ...defaultConfig, assetClass };
    this.defaultRiskParams = {
      stopLossPercent: defaultConfig.stopLossPercent,
      takeProfitPercent: defaultConfig.takeProfitPercent,
      trailingStopPercent: defaultConfig.trailingStopPercent || 1.5,
    };
  }

  private persistRiskState(symbol: string): void {
    try {
      const mode = config.getAccountMode();
      this.database.saveRiskState(mode, this.assetClass, symbol, {
        highWaterMark: this.highWaterMarkMap[symbol] || undefined,
        peakStallCount: this.peakStallCountMap[symbol] || 0,
        scaledOut: this.scaledOutMap[symbol],
        lastBuyTime: this.lastBuyTimeMap[symbol] || undefined,
        lastSellTime: this.lastSellTimeMap[symbol] || undefined,
      });
    } catch {
      Logger.warn('Failed to update risk state.');
    }
  }

  private restoreRiskState(): void {
    try {
      const mode = config.getAccountMode();
      const states = this.database.loadRiskState(mode, this.assetClass);
      for (const s of states) {
        if (s.highWaterMark != null) {
          this.highWaterMarkMap[s.symbol] = s.highWaterMark;
        }
        if (s.peakStallCount > 0) {
          this.peakStallCountMap[s.symbol] = s.peakStallCount;
        }
        if (s.scaledOut) {
          this.scaledOutMap[s.symbol] = true;
        }
        if (s.lastBuyTime != null) {
          this.lastBuyTimeMap[s.symbol] = s.lastBuyTime;
        }
        if (s.lastSellTime != null) {
          this.lastSellTimeMap[s.symbol] = s.lastSellTime;
        }
      }
      if (states.length > 0) {
        this.logEvent(`Restored risk state for ${states.length} symbols from DB`, 'info');
      }
    } catch {
      Logger.warn('Failed to update risk state.');
    }
  }

  private clearRiskState(symbol: string): void {
    try {
      const mode = config.getAccountMode();
      this.database.deleteRiskState(mode, this.assetClass, symbol);
    } catch {
      Logger.warn('Failed to update risk state.');
    }
  }

  public logEvent(message: string, type: BotLog['type'] = 'info'): void {
    const timestamp = new Date().toISOString();
    const entry: BotLog = { timestamp, message, type };
    this.botLogs.unshift(entry);
    if (this.botLogs.length > 100) {
      this.botLogs.pop();
    }

    try {
      this.database.saveBotLog(entry, config.getAccountMode());
    } catch {
      Logger.warn('Failed to persist bot log.');
    }

    const tag = `[${this.assetClass.toUpperCase()}]`;
    switch (type) {
      case 'error': {
        Logger.error(`${tag} ${message}`);
        break;
      }
      case 'warning': {
        Logger.warn(`${tag} ${message}`);
        break;
      }
      case 'success': {
        Logger.success(`${tag} ${message}`);
        break;
      }
      default: {
        Logger.info(`${tag} ${message}`);
      }
    }
  }

  public async executeSmartOrder(symbol: string, qty: number, side: 'buy' | 'sell', reason?: string): Promise<void> {
    if (this.assetClass === 'crypto' || symbol.includes('/')) {
      await this.executeCryptoOrder(symbol, qty, side, reason);
      return;
    }

    if (this.currentConfig.extendedHours && MarketClock.isExtendedHours()) {
      const placed = await this.executeExtendedHoursOrder(symbol, qty, side, reason);
      if (placed) {
        return;
      }
    }

    await this.executeMarketOrder(symbol, qty, side, reason);
  }

  private async executeCryptoOrder(symbol: string, qty: number, side: 'buy' | 'sell', reason?: string): Promise<void> {
    const formattedSym = symbol.includes('/') ? symbol : `${symbol.slice(0, -3)}/${symbol.slice(-3)}`;
    let notional: number | undefined;
    if (side === 'buy') {
      notional = await this.computeCryptoBuyNotional(formattedSym, qty);
      this.logEvent(`Placing BUY $${notional} notional ${formattedSym} Market Order [CRYPTO] (${reason || 'N/A'})`, 'info');
    } else {
      this.logEvent(`Placing SELL ${qty} ${formattedSym} Market Order [CRYPTO] (${reason || 'N/A'})`, 'info');
    }

    await alpacaService.createOrder({
      symbol: formattedSym,
      qty,
      notional,
      side,
      type: 'market',
      time_in_force: 'gtc',
      asset_class: 'crypto',
      reason,
    });
    this.recordSell(symbol, side);
  }

  // Computes a crypto buy notional that meets Alpaca's $10 minimum, with a $15 safe floor.
  private async computeCryptoBuyNotional(formattedSym: string, qty: number): Promise<number> {
    try {
      const price = await alpacaService.getCurrentPrice(formattedSym);
      const rawNotional = (price || 0) * qty;
      return rawNotional < 15 ? 15 : Number.parseFloat(rawNotional.toFixed(2));
    } catch {
      return 15; // Safe fallback
    }
  }

  // Places an extended-hours limit order; returns false when no real-time price is available.
  private async executeExtendedHoursOrder(symbol: string, qty: number, side: 'buy' | 'sell', reason?: string): Promise<boolean> {
    const realTimePrice = await alpacaService.getCurrentPrice(symbol);
    const limitPrice = realTimePrice ? Math.round(realTimePrice * 100) / 100 : undefined;
    if (!limitPrice) {
      return false;
    }

    this.logEvent(
      `Placing ${side.toUpperCase()} ${qty} ${symbol} Limit Order at $${limitPrice} [EXTENDED HOURS] (${reason || 'N/A'})`,
      'info',
    );
    await alpacaService.createOrder({
      symbol,
      qty,
      side,
      type: 'limit',
      limit_price: limitPrice,
      time_in_force: 'day',
      extended_hours: true,
      reason,
    });
    this.recordSell(symbol, side);
    return true;
  }

  private async executeMarketOrder(symbol: string, qty: number, side: 'buy' | 'sell', reason?: string): Promise<void> {
    this.logEvent(`Placing ${side.toUpperCase()} ${qty} ${symbol} Market Order (${reason || 'N/A'})`, 'info');
    await alpacaService.createOrder({ symbol, qty, side, type: 'market', time_in_force: 'day', reason });
    this.recordSell(symbol, side);
  }

  // Records the sell timestamp and persists risk state after a sell order.
  private recordSell(symbol: string, side: 'buy' | 'sell'): void {
    if (side === 'sell') {
      this.lastSellTimeMap[symbol] = Date.now();
      this.persistRiskState(symbol);
    }
  }

  public async runRiskManagement(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    this.riskTick++;

    if (await this.runPreOpenSweep()) {
      return;
    }

    try {
      const positions = await alpacaService.getPositions();
      const openOrders = await alpacaService.getOrders('open', 50);
      const closedOrders = await alpacaService.getOrders('closed', 50);

      const targetPositions = positions.filter((position) => position.asset_class === this.assetClass);
      if (targetPositions.length === 0) {
        return;
      }

      const context: PositionRiskContext = {
        pendingSellOrdersMap: this.buildPendingSellMap(openOrders),
        expiredSellOrdersMap: this.buildExpiredSellMap(closedOrders),
        isMarketOpen: MarketClock.isMarketOpenOrOpeningSoon(this.assetClass),
        shouldLog: this.riskTick % 10 === 1,
      };

      for (const position of targetPositions) {
        await this.evaluatePosition(position, context);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logEvent(`Risk management error: ${message}`, 'error');
    }
  }

  // Cancels stale extended-hours limit orders in the 5 minutes before market open.
  // Returns true when the sweep ran and this cycle should stop early.
  private async runPreOpenSweep(): Promise<boolean> {
    if (this.assetClass === 'crypto') {
      return false;
    }

    // Use getNYParts() directly — nowInNewYork() returns a shifted Date whose
    // .getHours() reads back the server's UTC hour, not the NY hour (timezone bug).
    const ny = MarketClock.getNYParts();
    const dayOfWeek = ny.dayOfWeek;
    const totalMinutes = ny.totalMinutes;
    const sweepWindowStart = MarketClock.REGULAR_OPEN_MINUTES - 5; // 9:25 AM ET
    const isWeekday = dayOfWeek >= MarketClock.MONDAY && dayOfWeek <= MarketClock.FRIDAY;
    const isInSweepWindow = totalMinutes >= sweepWindowStart && totalMinutes < MarketClock.REGULAR_OPEN_MINUTES;
    if (!isWeekday || !isInSweepWindow) {
      return false;
    }

    const todayString = `${ny.year}-${ny.month}-${ny.day}`;
    if (this.lastPreOpenSweepDate === todayString) {
      return false;
    }
    this.lastPreOpenSweepDate = todayString;

    try {
      const openOrders = await alpacaService.getOrders('open', 100);
      const limitOrders = openOrders.filter((order) => order.type === 'limit' && order.status === 'new');
      if (limitOrders.length > 0) {
        this.logEvent(`Pre-open sweep: cancelling ${limitOrders.length} stale limit orders before market opens...`, 'warning');
        for (const order of limitOrders) {
          try {
            await alpacaService.cancelOrder(order.id);
            this.logEvent(`Cancelled ${order.side.toUpperCase()} ${order.symbol} limit order ${order.id.slice(0, 8)}...`, 'info');
          } catch {
            Logger.warn('Failed to cancel limit order.');
          }
        }
      }
      this.logEvent('Pre-open sweep complete. Waiting for market open before placing new orders.', 'info');
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logEvent(`Pre-open sweep error: ${message}`, 'error');
      return false;
    }
  }

  private buildPendingSellMap(openOrders: AlpacaOrder[]): Record<string, AlpacaOrder> {
    const map: Record<string, AlpacaOrder> = {};
    for (const order of openOrders) {
      if (order.side === 'sell') {
        map[order.symbol] = order;
        map[matchKey(order.symbol)] = order;
      }
    }
    return map;
  }

  private buildExpiredSellMap(closedOrders: AlpacaOrder[]): Record<string, boolean> {
    const map: Record<string, boolean> = {};
    for (const order of closedOrders) {
      if (order.side === 'sell' && order.status === 'expired') {
        map[order.symbol] = true;
      }
    }
    return map;
  }

  // Computes the risk snapshot and updates the high-water-mark / peak-stall state.
  private computePositionSnapshot(position: AlpacaPosition, currentPrice: number, qty: number): PositionSnapshot {
    const isIndexEtf = INDEX_ACCUMULATION_TICKERS.has(position.symbol);
    const effectiveStopLoss = isIndexEtf ? 8 : this.currentConfig.stopLossPercent;
    const effectiveTakeProfit = isIndexEtf ? 20 : this.currentConfig.takeProfitPercent;
    const effectiveTrailing = isIndexEtf ? 5 : this.currentConfig.trailingStopPercent || 1.5;
    const scaleOutThreshold = isIndexEtf ? 10 : 1.5;

    const avgEntryPrice = Number.parseFloat(position.avg_entry_price);
    const gainPercent = ((currentPrice - avgEntryPrice) / avgEntryPrice) * 100;
    const plDollars = (currentPrice - avgEntryPrice) * qty;

    const previousPeak = this.highWaterMarkMap[position.symbol] || avgEntryPrice;
    const currentPeak = Math.max(previousPeak, currentPrice);
    this.highWaterMarkMap[position.symbol] = currentPeak;

    if (currentPeak > previousPeak) {
      this.peakStallCountMap[position.symbol] = 0;
    } else if (gainPercent >= 1) {
      this.peakStallCountMap[position.symbol] = (this.peakStallCountMap[position.symbol] || 0) + 1;
    }
    this.persistRiskState(position.symbol);

    const dropFromPeakPercent = ((currentPeak - currentPrice) / currentPeak) * 100;

    return {
      symbol: position.symbol,
      qty,
      currentPrice,
      avgEntryPrice,
      gainPercent,
      plDollars,
      currentPeak,
      dropFromPeakPercent,
      scaleOutThreshold,
      effectiveStopLoss,
      effectiveTakeProfit,
      effectiveTrailing,
    };
  }

  private async evaluatePosition(position: AlpacaPosition, context: PositionRiskContext): Promise<void> {
    // Use Alpaca's real-time position price first; fall back to bar close for test mocks.
    const currentPrice = Number(position.current_price) || (await alpacaService.getLatestBar(position.symbol))?.c || 0;
    if (!currentPrice) {
      return;
    }

    const qty = Math.abs(Number.parseFloat(position.qty));
    if (qty === 0) {
      return;
    }

    if (CASH_EQUIVALENT_TICKERS.has(position.symbol)) {
      if (context.shouldLog) {
        this.logEvent(`T-bill hold: ${position.symbol} ${qty} shares — long-term yield, no stop applied`, 'info');
      }
      return;
    }

    const snapshot = this.computePositionSnapshot(position, currentPrice, qty);

    if (context.shouldLog) {
      const sign = snapshot.gainPercent >= 0 ? '+' : '';
      this.logEvent(
        `P/L: ${snapshot.symbol} ${qty} shares | ${sign}${snapshot.gainPercent.toFixed(2)}% (${sign}$${snapshot.plDollars.toFixed(2)}) | Entry $${snapshot.avgEntryPrice.toFixed(2)} → Now $${currentPrice.toFixed(2)} | Peak $${snapshot.currentPeak.toFixed(2)}`,
      );
    }

    if (await this.handlePendingSell(position, context)) {
      return;
    }
    if (!context.isMarketOpen && this.assetClass !== 'crypto') {
      return;
    }
    if (await this.skipIfExpiredSell(position, context)) {
      return;
    }

    if (await this.tryScaleOut(snapshot)) {
      return;
    }
    if (await this.tryPeakStallExit(snapshot)) {
      return;
    }
    if (await this.tryTrailingStop(snapshot)) {
      return;
    }
    if (await this.tryStopLoss(snapshot)) {
      return;
    }
    await this.tryTakeProfit(snapshot);
  }

  // Returns true when we should skip to the next position (a sell is already pending).
  private async handlePendingSell(position: AlpacaPosition, context: PositionRiskContext): Promise<boolean> {
    const pending = context.pendingSellOrdersMap[position.symbol];
    if (!pending) {
      return false;
    }

    if (MarketClock.isExtendedHours() || this.assetClass === 'crypto') {
      if (context.shouldLog) {
        this.logEvent(
          `Sell already pending for ${position.symbol} (order ${pending.id.slice(0, 8)}...) — waiting for fill or expiry.`,
          'info',
        );
      }
      return true;
    }

    try {
      await alpacaService.cancelOrder(pending.id);
      this.logEvent(
        `Canceled stale pending sell for ${position.symbol} (order ${pending.id.slice(0, 8)}...) to re-exit at market.`,
        'warning',
      );
    } catch {
      Logger.warn('Failed to cancel order.');
    }
    return false;
  }

  private async skipIfExpiredSell(position: AlpacaPosition, context: PositionRiskContext): Promise<boolean> {
    if (
      this.assetClass === 'crypto' ||
      !context.expiredSellOrdersMap[position.symbol] ||
      MarketClock.isMarketOpenOrOpeningSoon(this.assetClass)
    ) {
      return false;
    }
    if (context.shouldLog) {
      this.logEvent(`Previous sell for ${position.symbol} expired. Waiting for regular session to retry.`, 'info');
    }
    return true;
  }

  private async tryScaleOut(snapshot: PositionSnapshot): Promise<boolean> {
    if (snapshot.gainPercent < snapshot.scaleOutThreshold || this.scaledOutMap[snapshot.symbol] || snapshot.qty < 2) {
      return false;
    }
    const scaleQty = Math.floor(snapshot.qty / 2);
    const reasonNote = `Take Profit: (50% scale-out @ +${snapshot.gainPercent.toFixed(2)}%)`;
    this.logEvent(`${reasonNote}: Selling ${scaleQty} of ${snapshot.qty} shares of ${snapshot.symbol}.`, 'success');
    this.scaledOutMap[snapshot.symbol] = true;
    this.persistRiskState(snapshot.symbol);
    await this.executeSmartOrder(snapshot.symbol, scaleQty, 'sell', reasonNote);
    return true;
  }

  private async tryPeakStallExit(snapshot: PositionSnapshot): Promise<boolean> {
    if (snapshot.gainPercent < 1 || (this.peakStallCountMap[snapshot.symbol] || 0) < 3) {
      return false;
    }
    const reasonNote = `Peak Stall Exit: No new peak high for 90s @ +${snapshot.gainPercent.toFixed(2)}%`;
    this.logEvent(`${reasonNote}. Selling remaining ${snapshot.qty} shares.`, 'warning');
    await this.sellFullPosition(snapshot, reasonNote);
    return true;
  }

  private async tryTrailingStop(snapshot: PositionSnapshot): Promise<boolean> {
    const effectiveTrailingStop =
      snapshot.gainPercent >= snapshot.scaleOutThreshold ? snapshot.effectiveTrailing / 3 : snapshot.effectiveTrailing;
    if (snapshot.currentPeak <= snapshot.avgEntryPrice || snapshot.dropFromPeakPercent < effectiveTrailingStop) {
      return false;
    }
    const reasonNote = `Tight Peak Trailing Stop: ${snapshot.dropFromPeakPercent.toFixed(2)}% drop from peak $${snapshot.currentPeak.toFixed(2)} (gain was +${snapshot.gainPercent.toFixed(2)}%)`;
    this.logEvent(`${reasonNote}. Selling remaining ${snapshot.qty} shares.`, 'warning');
    await this.sellFullPosition(snapshot, reasonNote);
    return true;
  }

  private async tryStopLoss(snapshot: PositionSnapshot): Promise<boolean> {
    if (snapshot.gainPercent > -snapshot.effectiveStopLoss) {
      return false;
    }
    const reasonNote = `Stop Loss: ${snapshot.gainPercent.toFixed(2)}% (≤ -${snapshot.effectiveStopLoss}%)`;
    this.logEvent(`${reasonNote}. Selling.`, 'warning');
    await this.sellFullPosition(snapshot, reasonNote);
    return true;
  }

  private async tryTakeProfit(snapshot: PositionSnapshot): Promise<boolean> {
    if (snapshot.gainPercent < snapshot.effectiveTakeProfit) {
      return false;
    }
    const reasonNote = `Take Profit: +${snapshot.gainPercent.toFixed(2)}% (≥ +${snapshot.effectiveTakeProfit}%)`;
    this.logEvent(`${reasonNote}. Selling.`, 'success');
    await this.sellFullPosition(snapshot, reasonNote);
    return true;
  }

  private async sellFullPosition(snapshot: PositionSnapshot, reasonNote: string): Promise<void> {
    delete this.highWaterMarkMap[snapshot.symbol];
    delete this.peakStallCountMap[snapshot.symbol];
    delete this.scaledOutMap[snapshot.symbol];
    this.clearRiskState(snapshot.symbol);
    await this.executeSmartOrder(snapshot.symbol, snapshot.qty, 'sell', reasonNote);
  }

  public async runStrategyCycle(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    if (this.assetClass === 'us_equity' && !MarketClock.isMarketOpenOrOpeningSoon('us_equity')) {
      return;
    }
    // Only open new positions during regular market hours (9:30 AM–4:00 PM ET).
    // Pre-market/after-hours limit orders fill at bad prices — this is where the
    // overnight bleed happened. Risk management still runs to exit positions.
    if (this.assetClass === 'us_equity' && MarketClock.isExtendedHours()) {
      return;
    }

    this.logEvent(`Strategy cycle (${this.currentConfig.strategy.toUpperCase()})`);

    try {
      const context = await this.buildStrategyContext();
      if (context === null) {
        return;
      }

      await this.cancelStaleLimitOrders(context);
      await this.runNewsSentimentStrategy(context);
      await this.runTechnicalStrategy(context);
      await this.runTbillSweep(context);
      await this.runIndexAccumulation(context);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logEvent(`Strategy cycle error: ${message}`, 'error');
    }
  }

  private async buildStrategyContext(): Promise<StrategyContext | null> {
    const account = await alpacaService.getAccount();
    if (account.trading_blocked || account.account_blocked) {
      this.logEvent('Account trading is blocked by Alpaca. Skipping cycle.', 'warning');
      return null;
    }

    const todayRealizedPl = await portfolioService.getTodayRealizedPl();
    const memeBudget = Math.max(0, todayRealizedPl * MEME_PROFIT_SHARE);
    this.logEvent(`Profit gate: today realized $${todayRealizedPl.toFixed(2)}, volatile budget $${memeBudget.toFixed(2)}`, 'info');

    // Daily loss limit: stop opening new positions once today's realized loss
    // crosses the threshold — prevents death-by-a-thousand-cuts overtrading.
    if (this.assetClass === 'us_equity' && todayRealizedPl <= DAILY_LOSS_LIMIT) {
      this.logEvent(
        `Daily loss limit hit (today realized $${todayRealizedPl.toFixed(2)} ≤ $${DAILY_LOSS_LIMIT}). Halting new buys until next day.`,
        'warning',
      );
      await this.handleDailyLossBreach(todayRealizedPl);
      return null;
    }

    const positions = await alpacaService.getPositions();
    const openOrders = await alpacaService.getOrders('open', 50);

    // Default to the curated MATURE watchlist (large-caps + broad ETFs).
    // Do NOT use getTopMovers() — that pulls in the market's top % gainers,
    // which are always micro-caps and leveraged ETFs (the meme-stock bleed).
    const activeWatchlist =
      this.assetClass === 'crypto'
        ? await alpacaService.getTopCryptoMovers()
        : (this.currentConfig.watchlist && this.currentConfig.watchlist.length > 0
          ? this.currentConfig.watchlist
          : await alpacaService.getTopMovers());

    return {
      account,
      positionMap: this.buildPositionMap(positions),
      pendingBuyOrdersMap: this.buildPendingBuyMap(openOrders),
      openOrders,
      activeWatchlist,
      memeBudget,
    };
  }

  private buildPositionMap(positions: AlpacaPosition[]): Record<string, AlpacaPosition> {
    const map: Record<string, AlpacaPosition> = {};
    for (const position of positions) {
      map[position.symbol] = position;
      map[matchKey(position.symbol)] = position;
    }
    return map;
  }

  private buildPendingBuyMap(openOrders: AlpacaOrder[]): Record<string, AlpacaOrder> {
    const map: Record<string, AlpacaOrder> = {};
    for (const order of openOrders) {
      if (order.side !== 'buy') {
        continue;
      }
      map[order.symbol] = order;
      map[matchKey(order.symbol)] = order;
    }
    return map;
  }

  // Regular session: cancel stale extended-hours limit orders that would hold shares hostage.
  private async cancelStaleLimitOrders(context: StrategyContext): Promise<void> {
    if (this.assetClass !== 'us_equity' || MarketClock.isExtendedHours()) {
      return;
    }

    for (const order of context.openOrders) {
      if (order.type !== 'limit') {
        continue;
      }
      try {
        await alpacaService.cancelOrder(order.id);
        this.logEvent(`Canceled stale limit order ${order.id.slice(0, 8)} for ${order.symbol} at market open.`, 'warning');
      } catch {
        Logger.warn('Failed to cancel order.');
      }
    }
  }

  private async runNewsSentimentStrategy(context: StrategyContext): Promise<void> {
    if (this.assetClass !== 'crypto' && MarketClock.isExtendedHours()) {
      return;
    }

    const sentiments = await newsService.analyzeNewsSentiment(context.activeWatchlist, true);
    await this.buyOnBullishNews(
      sentiments.find((s) => s.score >= 0.15),
      context,
    );
    await this.actOnBearishNews(
      sentiments.find((s) => s.score <= -0.15),
      context,
    );
  }

  private async buyOnBullishNews(topBullish: StockSentiment | undefined, context: StrategyContext): Promise<void> {
    if (!topBullish || (this.assetClass === 'crypto' && IS_DISABLE_CRYPTO_BUYS)) {
      return;
    }

    this.logEvent(`News: ${topBullish.symbol} +${topBullish.score} — "${topBullish.topHeadline}"`, 'success');

    const now = Date.now();
    const isCoolingDown = now - (this.lastBuyTimeMap[topBullish.symbol] || 0) < BUY_COOLDOWN_MS;
    const isRecentlySold = now - (this.lastSellTimeMap[topBullish.symbol] || 0) < this.REENTRY_COOLDOWN_MS;
    if (context.positionMap[topBullish.symbol] || context.pendingBuyOrdersMap[topBullish.symbol] || isCoolingDown || isRecentlySold) {
      return;
    }

    this.lastBuyTimeMap[topBullish.symbol] = now;
    this.persistRiskState(topBullish.symbol);

    const price = (await alpacaService.getCurrentPrice(topBullish.symbol)) || 0;
    const availableCash = Number.parseFloat(context.account.cash || '0');
    const qty = await BotManager.calculatePositionSize(
      topBullish.symbol,
      price,
      topBullish.score,
      topBullish.headlines,
      availableCash,
      1,
      this.assetClass,
    );
    if (qty <= 0) {
      return;
    }

    const reasonNote = `News Sentiment (${topBullish.score >= 0 ? '+' : ''}${topBullish.score.toFixed(2)}): ${topBullish.topHeadline}`;
    this.logEvent(`Buying ${qty} ${topBullish.symbol} on news sentiment using liquid cash.`, 'success');
    await this.executeSmartOrder(topBullish.symbol, qty, 'buy', reasonNote);
  }

  private async actOnBearishNews(topBearish: StockSentiment | undefined, context: StrategyContext): Promise<void> {
    if (!topBearish) {
      return;
    }

    if (INDEX_ACCUMULATION_TICKERS.has(topBearish.symbol) || CASH_EQUIVALENT_TICKERS.has(topBearish.symbol)) {
      this.logEvent(`Index / cash equivalent hold: ${topBearish.symbol} protected from news panic sell`, 'info');
      return;
    }

    if (context.pendingBuyOrdersMap[topBearish.symbol]) {
      this.logEvent(`News bearish: canceling pending buy ${context.pendingBuyOrdersMap[topBearish.symbol].id}.`, 'warning');
      await alpacaService.cancelOrder(context.pendingBuyOrdersMap[topBearish.symbol].id);
    }

    if (!context.positionMap[topBearish.symbol]) {
      return;
    }

    const pendingSells = await alpacaService.getOrders('open', 50);
    const hasPendingSell = pendingSells.some((order) => order.side === 'sell' && order.symbol === topBearish.symbol);
    if (hasPendingSell) {
      return;
    }

    const reasonNote = `News Bearish (${topBearish.score.toFixed(2)}): ${topBearish.topHeadline}`;
    this.logEvent(`News bearish: selling held ${topBearish.symbol}.`, 'warning');
    delete this.highWaterMarkMap[topBearish.symbol];
    this.clearRiskState(topBearish.symbol);
    await this.executeSmartOrder(
      topBearish.symbol,
      Math.abs(Number.parseFloat(context.positionMap[topBearish.symbol].qty)),
      'sell',
      reasonNote,
    );
  }

  private async runTechnicalStrategy(context: StrategyContext): Promise<void> {
    const techSignals = await technicalService.analyzeWatchlist(context.activeWatchlist);

    let techBuysThisCycle = 0;
    let memeSpentThisCycle = 0;

    for (const signal of techSignals) {
      const minConfidence = signal.action === 'SELL' ? TECH_SELL_MIN_CONFIDENCE : TECH_MIN_CONFIDENCE;
      if (signal.confidence < minConfidence) {
        continue;
      }

      if (signal.action === 'BUY' && !context.positionMap[signal.symbol] && !context.pendingBuyOrdersMap[signal.symbol]) {
        const outcome = await this.tryTechnicalBuy(signal, context, techBuysThisCycle, memeSpentThisCycle);
        techBuysThisCycle = outcome.techBuysThisCycle;
        memeSpentThisCycle = outcome.memeSpentThisCycle;
        if (outcome.control === 'continue') {
          continue;
        }
        if (outcome.control === 'break') {
          break;
        }
      } else if (signal.action === 'SELL' && context.positionMap[signal.symbol]) {
        // Index / cash-equivalent holdings are long-horizon — never exit them on a
        // technical signal (mirrors the news-panic protection in actOnBearishNews).
        if (INDEX_ACCUMULATION_TICKERS.has(signal.symbol) || CASH_EQUIVALENT_TICKERS.has(signal.symbol)) {
          this.logEvent(`Technical sell skipped: ${signal.symbol} is a long-horizon index / cash-equivalent holding.`, 'info');
          continue;
        }
        await this.executeTechnicalSell(signal, context);
      }
    }
  }

  private async tryTechnicalBuy(
    signal: TechnicalSignal,
    context: StrategyContext,
    techBuysThisCycle: number,
    memeSpentThisCycle: number,
  ): Promise<TechnicalBuyOutcome> {
    if (this.assetClass === 'crypto' && IS_DISABLE_CRYPTO_BUYS) {
      return { control: 'continue', techBuysThisCycle, memeSpentThisCycle };
    }
    if (techBuysThisCycle >= MAX_TECH_BUYS_PER_CYCLE) {
      return { control: 'break', techBuysThisCycle, memeSpentThisCycle };
    }
    const now = Date.now();
    if (now - (this.lastBuyTimeMap[signal.symbol] || 0) < BUY_COOLDOWN_MS) {
      return { control: 'continue', techBuysThisCycle, memeSpentThisCycle };
    }
    if (now - (this.lastSellTimeMap[signal.symbol] || 0) < this.REENTRY_COOLDOWN_MS) {
      return { control: 'continue', techBuysThisCycle, memeSpentThisCycle };
    }
    if (this.assetClass === 'crypto' && signal.indicators.priceChangePct5Min <= 0.5) {
      return { control: 'continue', techBuysThisCycle, memeSpentThisCycle };
    }
    this.lastBuyTimeMap[signal.symbol] = now;
    this.persistRiskState(signal.symbol);

    const reasonNote = `Technical BUY (${signal.reason})`;
    const price = (await alpacaService.getCurrentPrice(signal.symbol)) || 0;
    const availableCash = Number.parseFloat(context.account.cash || '0');
    const averageTrueRangePct = signal.indicators.averageTrueRangePct || 0;

    let qty = 0;
    if (averageTrueRangePct > VOLATILE_ATR_PCT) {
      const sizing = this.sizeVolatilePosition(signal, price, context, memeSpentThisCycle);
      if (sizing === null) {
        return { control: 'continue', techBuysThisCycle, memeSpentThisCycle };
      }
      qty = sizing.qty;
      memeSpentThisCycle = sizing.memeSpentThisCycle;
    } else {
      qty = await BotManager.calculatePositionSize(
        signal.symbol,
        price,
        signal.confidence,
        [signal.reason],
        availableCash,
        1,
        this.assetClass,
      );
    }

    this.logEvent(`Technical: ${signal.symbol} ${signal.reason} (confidence: ${signal.confidence})`, 'success');
    if (qty > 0) {
      const sleeve = await this.evaluateSleeveGate(signal.symbol, qty * price, context);
      if (!sleeve.allowed) {
        this.logEvent(`Sleeve blocked ${signal.symbol}: ${sleeve.reason}`, 'warning');
        return { control: 'continue', techBuysThisCycle, memeSpentThisCycle };
      }
      await this.executeSmartOrder(signal.symbol, qty, 'buy', reasonNote);
      techBuysThisCycle++;
    }
    return { control: 'none', techBuysThisCycle, memeSpentThisCycle };
  }

  /**
   * When the daily loss limit trips, optionally de-risk the high-beta sleeve.
   * Halting new buys stops the bleeding but leaves the losing book on; this is
   * the part that can actually reduce what is already held. Default = shadow
   * mode (log intent, take no action) so it can be observed before enabling.
   */
  private async handleDailyLossBreach(todayRealizedPl: number): Promise<void> {
    if (!RISK_ON_SLEEVE_ENABLED) {
      return;
    }
    try {
      const positions = await alpacaService.getPositions();
      const highBeta = positions.filter((position) => isHighBeta(position.symbol) && Number(position.qty) > 0);
      if (highBeta.length === 0) {
        return;
      }
      const symbols = highBeta.map((position) => position.symbol);

      if (!SLEEVE_FLATTEN_ON_BREACH) {
        this.logEvent(
          `Daily-loss breach ($${todayRealizedPl.toFixed(2)}): would de-risk sleeve [${symbols.join(', ')}] — flatten disabled (shadow mode).`,
          'warning',
        );
        return;
      }

      await Promise.all(
        highBeta.map(async (position): Promise<void> => {
          try {
            await alpacaService.closePosition(position.symbol);
            this.logEvent(`De-risked: closed high-beta ${position.symbol} after daily-loss breach.`, 'warning');
          } catch (error) {
            this.logEvent(
              `Failed to de-risk ${position.symbol}: ${error instanceof Error ? error.message : String(error)}`,
              'error',
            );
          }
        }),
      );
    } catch (error) {
      this.logEvent(`De-risk sweep failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }

  /**
   * Gate for the aggressive high-beta sleeve. Strict no-op unless the sleeve is
   * enabled AND the candidate is a high-beta name, so enabling is all-or-nothing.
   */
  private async evaluateSleeveGate(
    symbol: string,
    notional: number,
    context: StrategyContext,
  ): Promise<{ allowed: boolean; reason: string }> {
    if (!RISK_ON_SLEEVE_ENABLED || this.assetClass !== 'us_equity' || !isHighBeta(symbol)) {
      return { allowed: true, reason: 'sleeve not applicable' };
    }

    const regime = await marketRegimeService.getRegime();
    if (!regime.riskOn) {
      return {
        allowed: false,
        reason: `risk-off regime (${regime.symbol} $${regime.price.toFixed(2)} vs SMA${REGIME_SMA_PERIOD} $${regime.sma.toFixed(2)}; source=${regime.source})`,
      };
    }

    const equity = Number.parseFloat(context.account.equity) || 0;
    const decision = evaluateHighBetaExposure(Object.values(context.positionMap), equity, symbol, notional);
    return { allowed: decision.allowed, reason: decision.reason };
  }

  private sizeVolatilePosition(
    signal: TechnicalSignal,
    price: number,
    context: StrategyContext,
    memeSpentThisCycle: number,
  ): { qty: number; memeSpentThisCycle: number } | null {
    const averageTrueRangePct = signal.indicators.averageTrueRangePct || 0;
    if (context.memeBudget <= 0) {
      this.logEvent(`Skip ${signal.symbol}: volatile (ATR ${averageTrueRangePct}%) but no realized profit budget`, 'info');
      return null;
    }
    const qty = BotManager.volatilitySizedQty(price, averageTrueRangePct);
    const notional = qty * price;
    if (memeSpentThisCycle + notional > context.memeBudget) {
      this.logEvent(
        `Skip ${signal.symbol}: volatile budget exhausted (spent $${memeSpentThisCycle.toFixed(0)} of $${context.memeBudget.toFixed(0)})`,
        'info',
      );
      return null;
    }
    this.logEvent(
      `Volatile entry ${signal.symbol} (ATR ${averageTrueRangePct}%): ${qty} sh @ $${price.toFixed(2)} = $${notional.toFixed(0)}`,
      'success',
    );
    return { qty, memeSpentThisCycle: memeSpentThisCycle + notional };
  }

  private async executeTechnicalSell(signal: TechnicalSignal, context: StrategyContext): Promise<void> {
    const reasonNote = `Technical SELL (${signal.reason})`;
    this.logEvent(`Technical sell: ${signal.symbol} ${signal.reason} (confidence: ${signal.confidence})`, 'warning');
    delete this.highWaterMarkMap[signal.symbol];
    this.clearRiskState(signal.symbol);
    try {
      await this.executeSmartOrder(signal.symbol, Math.abs(Number.parseFloat(context.positionMap[signal.symbol].qty)), 'sell', reasonNote);
    } catch {
      this.logEvent(`Technical sell skipped (position likely already closed): ${signal.symbol}`, 'warning');
    }
  }

  private async runTbillSweep(context: StrategyContext): Promise<void> {
    if (this.assetClass !== 'us_equity') {
      return;
    }

    const totalPortfolioValue = Number.parseFloat(context.account.equity || '0');
    const cashOnHand = Number.parseFloat(context.account.cash || '0');
    const cashPct = totalPortfolioValue > 0 ? (cashOnHand / totalPortfolioValue) * 100 : 0;

    const tbillValue = Object.values(context.positionMap)
      .filter((position) => CASH_EQUIVALENT_TICKERS.has(position.symbol))
      .reduce((sum, position) => sum + (Number.parseFloat(position.market_value) || 0), 0);
    const tbillPct = totalPortfolioValue > 0 ? (tbillValue / totalPortfolioValue) * 100 : 0;

    if (cashPct < TBILL_CASH_MIN_PCT || tbillPct >= TBILL_ALLOCATION_PCT * 100) {
      return;
    }

    for (const ticker of CASH_EQUIVALENT_TICKERS) {
      if (context.positionMap[ticker]) {
        continue;
      }
      const now = Date.now();
      if (now - (this.lastBuyTimeMap[ticker] || 0) < INDEX_COOLDOWN_MS) {
        continue;
      }
      if (now - (this.lastSellTimeMap[ticker] || 0) < this.REENTRY_COOLDOWN_MS) {
        continue;
      }

      const price = (await alpacaService.getCurrentPrice(ticker)) || 0;
      if (price <= 0) {
        continue;
      }

      const qty = Math.floor((cashOnHand * TBILL_BUY_PCT) / price);
      if (qty < 1) {
        continue;
      }

      this.lastBuyTimeMap[ticker] = now;
      this.persistRiskState(ticker);
      const reasonNote = `T-bill sweep: ${cashPct.toFixed(0)}% cash idle, parking in ${ticker} for yield`;
      this.logEvent(reasonNote, 'success');
      await this.executeSmartOrder(ticker, qty, 'buy', reasonNote);
      break; // max 1 T-bill buy per cycle
    }
  }

  private async runIndexAccumulation(context: StrategyContext): Promise<void> {
    if (this.assetClass !== 'us_equity') {
      return;
    }

    const totalPortfolioValue = Number.parseFloat(context.account.equity || '0');
    const cashOnHand = Number.parseFloat(context.account.cash || '0');
    const cashPct = totalPortfolioValue > 0 ? (cashOnHand / totalPortfolioValue) * 100 : 0;
    if (cashPct < INDEX_CASH_MIN_PCT) {
      return;
    }

    for (const indexTicker of INDEX_ACCUMULATION_TICKERS) {
      if (context.positionMap[indexTicker]) {
        continue;
      }
      const now = Date.now();
      if (now - (this.lastBuyTimeMap[indexTicker] || 0) < INDEX_COOLDOWN_MS) {
        continue;
      }
      if (now - (this.lastSellTimeMap[indexTicker] || 0) < this.REENTRY_COOLDOWN_MS) {
        continue;
      }

      const price = (await alpacaService.getCurrentPrice(indexTicker)) || 0;
      if (price <= 0) {
        continue;
      }

      const qty = Math.floor((cashOnHand * 0.15) / price);
      if (qty < 1) {
        continue;
      }

      this.lastBuyTimeMap[indexTicker] = now;
      this.persistRiskState(indexTicker);
      const reasonNote = `Index Accumulation: ${cashPct.toFixed(0)}% cash idle, buying ${indexTicker} for long-term growth`;
      this.logEvent(reasonNote, 'success');
      await this.executeSmartOrder(indexTicker, qty, 'buy', reasonNote);
      break; // max 1 index buy per cycle
    }
  }

  public start(overrides: Partial<BotConfig> = {}, startingEquity?: number): BotStatus {
    if (this.isRunning) {
      this.logEvent('Bot is already running.', 'warning');
      return this.getStatus();
    }

    this.currentConfig = { ...this.currentConfig, ...overrides, ...this.defaultRiskParams, assetClass: this.assetClass };
    this.isRunning = true;

    this.database.saveBotState(true, this.currentConfig, config.getAccountMode(), startingEquity);
    this.restoreRiskState();
    this.logEvent(`Started — assetClass=${this.assetClass.toUpperCase()}, strategy=${this.currentConfig.strategy.toUpperCase()}`);

    void this.runRiskManagement();
    this.riskInterval = setInterval(async () => this.runRiskManagement(), RISK_CHECK_SECONDS * 1000);

    void this.runStrategyCycle();
    this.strategyInterval = setInterval(async () => this.runStrategyCycle(), this.currentConfig.intervalSeconds * 1000);

    return this.getStatus();
  }

  public stop(): BotStatus {
    if (!this.isRunning) {
      this.logEvent('Bot is not currently running.', 'warning');
      return this.getStatus();
    }

    if (this.riskInterval) {
      clearInterval(this.riskInterval);
      this.riskInterval = null;
    }
    if (this.strategyInterval) {
      clearInterval(this.strategyInterval);
      this.strategyInterval = null;
    }
    this.isRunning = false;

    this.database.saveBotState(false, this.currentConfig, config.getAccountMode());
    this.logEvent('Bot stopped.');
    return this.getStatus();
  }

  public getStatus(): BotStatus {
    return { isRunning: this.isRunning, config: this.currentConfig, logs: this.botLogs };
  }
}
