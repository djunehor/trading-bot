import { getCurrentPrice, getPositions, createOrder, getAccount, getOrders, cancelOrder, getTopMovers, getTopCryptoMovers, getTodayRealizedPl } from './alpacaService.js';
import { analyzeNewsSentiment } from './newsService.js';
import { getAccountMode } from '../config/alpaca.js';
import { saveBotLogDb, saveBotStateDb, getBotStateDb, saveBotRiskState, loadBotRiskState, deleteBotRiskState } from '../db/database.js';
import { BotConfig, BotLog, BotStatus, TradeSignal } from '../types/alpaca.js';
import { createLogger } from './logger.js';
import { analyzeWatchlist, TechnicalSignal } from './technicalService.js';

const log = createLogger('TradingBot');

// Strip slashes for symbol matching: Alpaca positions use SOLUSD, orders/signals use SOL/USD
function matchKey(symbol: string): string {
  return symbol ? symbol.replace('/', '').toUpperCase() : symbol;
}

const BUY_COOLDOWN_MS = 15 * 60 * 1000; // 15-minute minimum cooldown per symbol
const INDEX_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4-hour cooldown for index accumulation buys
const RISK_CHECK_SECONDS = 30; // stop-loss / trailing-stop / take-profit runs every 30s
const TECH_MIN_CONFIDENCE = 0.55; // act on technical signals with confidence >= 0.55
const INDEX_ACCUMULATION_TICKERS = ['SPY', 'QQQ']; // long-horizon index ETFs
const INDEX_CASH_MIN_PCT = 40; // only accumulate indexes if cash is >40% of portfolio

// ── Cash-equivalent T-bill ETFs — long-term yield parking, never stop-lossed ──
const CASH_EQUIVALENT_TICKERS = ['SGOV', 'BIL', 'USFR'];
const TBILL_ALLOCATION_PCT = 0.20; // target: up to 20% of portfolio in T-bills
const TBILL_CASH_MIN_PCT = 20;     // sweep cash into T-bills only when cash > 20% of portfolio
const TBILL_BUY_PCT = 0.10;        // deploy 10% of cash per sweep

// Stop the crypto bot from opening new BUY positions — sell-only mode.
// Existing positions are still exited by risk management / sell signals.
const DISABLE_CRYPTO_BUYS = true;

// ── Volatility-scaled sizing & profit-gated risk for volatile names ──
const VOLATILE_ATR_PCT = 3;       // ATR% > 3% per bar = volatile/meme stock
const RISK_BUDGET_PER_TRADE = 25; // a 1-ATR move should cost ~$25 regardless of volatility
const MEME_PROFIT_SHARE = 0.5;    // max volatile exposure = 50% of today's realized profit

const DEFAULT_STOCK_CONFIG: BotConfig = {
  symbol: 'AAPL',
  qty: 1,
  intervalSeconds: 300,
  strategy: 'news_sentiment',
  stopLossPercent: 2.0,
  takeProfitPercent: 3.0,
  trailingStopPercent: 1.5,
  extendedHours: true,
  assetClass: 'us_equity',
  watchlist: [
    'AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN', 'META', 'GOOGL', 'AMD',
    'NFLX', 'PLTR', 'SPY', 'QQQ', 'QCOM', 'DIS', 'COIN', 'JPM',
    'V', 'UNH', 'BA', 'COST',
    'BE', 'NOVT', 'ZVRA', 'SOFI', 'ITRI', 'DLO', 'MU', 'ONDS',
    'CLBT', 'NET', 'WSE', 'SNDK', 'DOCN'
  ]
};

const DEFAULT_CRYPTO_WATCHLIST = [
  'BTC/USD', 'ETH/USD', 'SOL/USD', 'DOGE/USD', 'AVAX/USD',
  'LINK/USD', 'UNI/USD', 'BCH/USD', 'LTC/USD', 'DOT/USD'
];

const DEFAULT_CRYPTO_CONFIG: BotConfig = {
  symbol: 'BTC/USD',
  qty: 1,
  intervalSeconds: 300,
  strategy: 'momentum',
  stopLossPercent: 1.5,
  takeProfitPercent: 3.0,
  trailingStopPercent: 1.5,
  extendedHours: false,
  assetClass: 'crypto',
  watchlist: DEFAULT_CRYPTO_WATCHLIST
};

export function isExtendedHours(): boolean {
  try {
    const now = new Date();
    const nyString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const nyDate = new Date(nyString);
    const hours = nyDate.getHours();
    const minutes = nyDate.getMinutes();
    const totalMinutes = hours * 60 + minutes;

    const marketOpenMinutes = 9 * 60 + 30; // 9:30 AM EST
    const marketCloseMinutes = 16 * 60;    // 4:00 PM EST

    return totalMinutes < marketOpenMinutes || totalMinutes >= marketCloseMinutes;
  } catch {
    return false;
  }
}

export function isMarketOpenOrOpeningSoon(assetClass: 'us_equity' | 'crypto' = 'us_equity'): boolean {
  if (assetClass === 'crypto') return true;

  try {
    const now = new Date();
    const nyString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const nyDate = new Date(nyString);
    const dayOfWeek = nyDate.getDay();
    const hours = nyDate.getHours();
    const minutes = nyDate.getMinutes();
    const totalMinutes = hours * 60 + minutes;

    // 24/5 trading: Sunday 8 PM ET → Friday 8 PM ET. Closed Fri 8 PM → Sun 8 PM.
    if (dayOfWeek === 6) return false;                              // Saturday: closed
    if (dayOfWeek === 0 && totalMinutes < 20 * 60) return false;     // Sunday before 8 PM: closed
    if (dayOfWeek === 5 && totalMinutes >= 20 * 60) return false;    // Friday after 8 PM: closed
    return true;
  } catch {
    return true;
  }
}

export async function calculatePositionSize(
  symbol: string,
  price: number,
  sentimentScore: number,
  headlines: string[],
  availableCash: number,
  fallbackQty: number = 0,
  assetClass: 'us_equity' | 'crypto' = 'us_equity'
): Promise<number> {
  if (!price || price <= 0 || !availableCash || availableCash <= 0) return 0;

  // Deterministic 5% cash sizing — no LLM. Predictable and always sane.
  const cashBasedQty = Math.max(1, Math.floor((availableCash * 0.05) / price));

  if (assetClass === 'crypto') {
    const targetNotional = availableCash * 0.05;
    const qty = targetNotional / price;
    const minQty = 15 / price;
    return Math.max(qty, minQty);
  }

  return cashBasedQty;
}

// Volatility-scaled position sizing: size so a 1-ATR move costs ~RISK_BUDGET.
export function volatilitySizedQty(price: number, atrPct: number): number {
  if (price <= 0 || atrPct <= 0) return 0;
  const positionValue = RISK_BUDGET_PER_TRADE / (atrPct / 100);
  return Math.max(1, Math.floor(positionValue / price));
}

export function evaluateTradingStrategy(prices: number[], strategyType: string = 'momentum', targetSymbol: string = 'AAPL'): TradeSignal {
  if (!prices || prices.length < 2) {
    return { action: 'HOLD', targetSymbol, reason: 'Insufficient price data' };
  }

  const latestPrice = prices[prices.length - 1];
  const previousPrice = prices[prices.length - 2];
  const priceChangePercent = ((latestPrice - previousPrice) / previousPrice) * 100;

  if (strategyType === 'momentum') {
    if (priceChangePercent > 0.05) {
      return { action: 'BUY', targetSymbol, reason: `Upward momentum (+${priceChangePercent.toFixed(2)}%)` };
    } else if (priceChangePercent < -0.05) {
      return { action: 'SELL', targetSymbol, reason: `Downward momentum (${priceChangePercent.toFixed(2)}%)` };
    }
  }

  return { action: 'HOLD', targetSymbol, reason: 'No trade condition met' };
}

// ── BotEngine Class ──────────────────────────────────────────────────

export class BotEngine {
  public assetClass: 'us_equity' | 'crypto';
  public isRunning: boolean = false;
  public riskInterval: NodeJS.Timeout | null = null;
  public strategyInterval: NodeJS.Timeout | null = null;
  public botLogs: BotLog[] = [];
  public riskTick: number = 0;

  public highWaterMarkMap: Record<string, number> = {};
  public peakStallCountMap: Record<string, number> = {};
  public scaledOutMap: Record<string, boolean> = {};
  public lastBuyTimeMap: Record<string, number> = {};
  public lastSellTimeMap: Record<string, number> = {};

  private readonly REENTRY_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours

  public currentConfig: BotConfig;
  private defaultRiskParams: { stopLossPercent: number; takeProfitPercent: number; trailingStopPercent: number };

  constructor(assetClass: 'us_equity' | 'crypto', defaultConfig: BotConfig) {
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
      const mode = getAccountMode();
      saveBotRiskState(mode, this.assetClass, symbol, {
        highWaterMark: this.highWaterMarkMap[symbol] || undefined,
        peakStallCount: this.peakStallCountMap[symbol] || 0,
        scaledOut: this.scaledOutMap[symbol] || false,
        lastBuyTime: this.lastBuyTimeMap[symbol] || undefined,
        lastSellTime: this.lastSellTimeMap[symbol] || undefined,
      });
    } catch { /* non-critical */ }
  }

  private restoreRiskState(): void {
    try {
      const mode = getAccountMode();
      const states = loadBotRiskState(mode, this.assetClass);
      for (const s of states) {
        if (s.highWaterMark != null) this.highWaterMarkMap[s.symbol] = s.highWaterMark;
        if (s.peakStallCount > 0) this.peakStallCountMap[s.symbol] = s.peakStallCount;
        if (s.scaledOut) this.scaledOutMap[s.symbol] = true;
        if (s.lastBuyTime != null) this.lastBuyTimeMap[s.symbol] = s.lastBuyTime;
        if (s.lastSellTime != null) this.lastSellTimeMap[s.symbol] = s.lastSellTime;
      }
      if (states.length > 0) {
        this.logEvent(`Restored risk state for ${states.length} symbols from DB`, 'info');
      }
    } catch { /* non-critical */ }
  }

  private clearRiskState(symbol: string): void {
    try {
      const mode = getAccountMode();
      deleteBotRiskState(mode, this.assetClass, symbol);
    } catch { /* non-critical */ }
  }

  public logEvent(message: string, type: BotLog['type'] = 'info'): void {
    const timestamp = new Date().toISOString();
    const entry: BotLog = { timestamp, message, type };
    this.botLogs.unshift(entry);
    if (this.botLogs.length > 100) this.botLogs.pop();

    try { saveBotLogDb(entry, getAccountMode()); } catch {}

    const tag = `[${this.assetClass.toUpperCase()}]`;
    if (type === 'error') log.error(`${tag} ${message}`);
    else if (type === 'warning') log.warn(`${tag} ${message}`);
    else if (type === 'success') log.success(`${tag} ${message}`);
    else log.info(`${tag} ${message}`);
  }

  public async executeSmartOrder(symbol: string, qty: number, side: 'buy' | 'sell', reason?: string): Promise<void> {
    if (this.assetClass === 'crypto' || symbol.includes('/')) {
      const formattedSym = symbol.includes('/') ? symbol : `${symbol.slice(0, -3)}/${symbol.slice(-3)}`;

      let notional: number | undefined;
      if (side === 'buy') {
        // Compute notional to ensure we meet Alpaca's $10 minimum
        try {
          const price = await getCurrentPrice(formattedSym);
          const rawNotional = (price || 0) * qty;
          notional = rawNotional < 15 ? 15 : parseFloat(rawNotional.toFixed(2));
        } catch {
          notional = 15; // Safe fallback
        }
        this.logEvent(`Placing ${side.toUpperCase()} $${notional} notional ${formattedSym} Market Order [CRYPTO] (${reason || 'N/A'})`, 'info');
      } else {
        this.logEvent(`Placing ${side.toUpperCase()} ${qty} ${formattedSym} Market Order [CRYPTO] (${reason || 'N/A'})`, 'info');
      }

      await createOrder({
        symbol: formattedSym,
        qty,
        notional,
        side,
        type: 'market',
        time_in_force: 'gtc',
        asset_class: 'crypto',
        reason
      });
      if (side === 'sell') { this.lastSellTimeMap[symbol] = Date.now(); this.persistRiskState(symbol); }
      return;
    }

    const inExtendedHours = this.currentConfig.extendedHours && isExtendedHours();
    if (inExtendedHours) {
      const realTimePrice = await getCurrentPrice(symbol);
      const limitPrice = realTimePrice ? Math.round(realTimePrice * 100) / 100 : undefined;

      if (limitPrice) {
        this.logEvent(`Placing ${side.toUpperCase()} ${qty} ${symbol} Limit Order at $${limitPrice} [EXTENDED HOURS] (${reason || 'N/A'})`, 'info');
        await createOrder({
          symbol,
          qty,
          side,
          type: 'limit',
          limit_price: limitPrice,
          time_in_force: 'day',
          extended_hours: true,
          reason
        });
        if (side === 'sell') { this.lastSellTimeMap[symbol] = Date.now(); this.persistRiskState(symbol); }
        return;
      }
    }

    this.logEvent(`Placing ${side.toUpperCase()} ${qty} ${symbol} Market Order (${reason || 'N/A'})`, 'info');
    await createOrder({ symbol, qty, side, type: 'market', reason });
    if (side === 'sell') { this.lastSellTimeMap[symbol] = Date.now(); this.persistRiskState(symbol); }
  }

  public async runRiskManagement(): Promise<void> {
    if (!this.isRunning) return;

    this.riskTick++;

    // ── Pre-open sweep: cancel stale limit orders 5 min before market opens ──
    if (this.assetClass !== 'crypto') {
      const now = new Date();
      const nyString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
      const nyDate = new Date(nyString);
      const dayOfWeek = nyDate.getDay();
      const totalMinutes = nyDate.getHours() * 60 + nyDate.getMinutes();
      const MARKET_OPEN = 9 * 60 + 30; // 9:30 AM ET
      const SWEEP_WINDOW_START = MARKET_OPEN - 5; // 9:25 AM ET
      const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
      const inSweepWindow = totalMinutes >= SWEEP_WINDOW_START && totalMinutes < MARKET_OPEN;

      if (isWeekday && inSweepWindow) {
        // Only sweep once per day
        const todayStr = nyDate.toDateString();
        if ((this as any)._lastPreOpenSweepDate !== todayStr) {
          (this as any)._lastPreOpenSweepDate = todayStr;
          try {
            const allOpen = await getOrders('open', 100);
            const limitOrders = (allOpen || []).filter((o: any) => o.type === 'limit' && o.status === 'new');
            if (limitOrders.length > 0) {
              this.logEvent(`Pre-open sweep: cancelling ${limitOrders.length} stale limit orders before market opens...`, 'warning');
              for (const o of limitOrders) {
                try {
                  await cancelOrder(o.id);
                  this.logEvent(`Cancelled ${o.side.toUpperCase()} ${o.symbol} limit order ${o.id.substring(0, 8)}...`, 'info');
                } catch { /* may already be gone */ }
              }
            }
            // Skip this risk cycle — don't place new orders until market opens
            this.logEvent('Pre-open sweep complete. Waiting for market open before placing new orders.', 'info');
            return;
          } catch (err: any) {
            this.logEvent(`Pre-open sweep error: ${err.message}`, 'error');
          }
        }
      }
    }

    // On weekends, still monitor P/L but don't place new stock orders
    const marketOpen = isMarketOpenOrOpeningSoon(this.assetClass);

    try {
      const positions = await getPositions();
      const openOrders = await getOrders('open', 50);
      const closedOrders = await getOrders('closed', 50);

      const targetPositions = (positions || []).filter(p =>
        p.asset_class === this.assetClass
      );

      const pendingSellOrdersMap: Record<string, any> = {};
      const pendingBuyOrdersMap: Record<string, any> = {};
      if (Array.isArray(openOrders)) {
        openOrders.forEach(o => {
          if (o.side === 'sell') {
            pendingSellOrdersMap[o.symbol] = o;
            pendingSellOrdersMap[matchKey(o.symbol)] = o;
          } else if (o.side === 'buy') {
            pendingBuyOrdersMap[o.symbol] = o;
            pendingBuyOrdersMap[matchKey(o.symbol)] = o;
          }
        });
      }

      const expiredSellOrdersMap: Record<string, boolean> = {};
      if (Array.isArray(closedOrders)) {
        closedOrders.forEach(o => {
          if (o.side === 'sell' && o.status === 'expired') {
            expiredSellOrdersMap[o.symbol] = true;
          }
        });
      }

      if (targetPositions.length === 0) return;

      const defaultTrailingStopPercent = this.currentConfig.trailingStopPercent || 1.5;
      const shouldLog = this.riskTick % 10 === 1;

      for (const pos of targetPositions) {
        // Use Alpaca's real-time position price for BOTH asset classes.
        // Bar close (5-min) lags during fast moves and misses stop-loss triggers.
        const currentPrice = Number(pos.current_price) || 0;
        if (!currentPrice) continue;

        const qty = Math.abs(parseFloat(pos.qty));
        if (qty === 0) continue;

        // Cash-equivalent T-bill ETFs (SGOV/BIL/USFR) are long-term yield parking.
        // They barely move by design — never apply stop-loss/take-profit/trailing.
        if (CASH_EQUIVALENT_TICKERS.includes(pos.symbol)) {
          if (shouldLog) {
            this.logEvent(`T-bill hold: ${pos.symbol} ${qty} shares — long-term yield, no stop applied`, 'info');
          }
          continue;
        }

        const isIndexEtf = INDEX_ACCUMULATION_TICKERS.includes(pos.symbol);

        // Index ETFs use wider risk bands (8% stop-loss, 20% take-profit, 5% trailing)
        const effectiveStopLoss = isIndexEtf ? 8.0 : this.currentConfig.stopLossPercent;
        const effectiveTakeProfit = isIndexEtf ? 20.0 : this.currentConfig.takeProfitPercent;
        const effectiveTrailing = isIndexEtf ? 5.0 : (this.currentConfig.trailingStopPercent || 1.5);
        const scaleOutThreshold = isIndexEtf ? 10.0 : 1.5;  // scale-out at 10% vs 1.5%

        const avgEntryPrice = parseFloat(pos.avg_entry_price);
        const gainPercent = ((currentPrice - avgEntryPrice) / avgEntryPrice) * 100;
        const plDollars = (currentPrice - avgEntryPrice) * qty;

        const previousPeak = this.highWaterMarkMap[pos.symbol] || avgEntryPrice;
        const currentPeak = Math.max(previousPeak, currentPrice);
        this.highWaterMarkMap[pos.symbol] = currentPeak;

        if (currentPeak > previousPeak) {
          this.peakStallCountMap[pos.symbol] = 0;
        } else if (gainPercent >= 1.0) {
          this.peakStallCountMap[pos.symbol] = (this.peakStallCountMap[pos.symbol] || 0) + 1;
        }
        // Persist updated peak & stall count
        this.persistRiskState(pos.symbol);

        const dropFromPeakPercent = ((currentPeak - currentPrice) / currentPeak) * 100;

        if (shouldLog) {
          const sign = gainPercent >= 0 ? '+' : '';
          this.logEvent(`P/L: ${pos.symbol} ${qty} shares | ${sign}${gainPercent.toFixed(2)}% (${sign}$${plDollars.toFixed(2)}) | Entry $${avgEntryPrice.toFixed(2)} → Now $${currentPrice.toFixed(2)} | Peak $${currentPeak.toFixed(2)}`);
        }

        if (pendingSellOrdersMap[pos.symbol]) {
          // Regular session: cancel the stale (likely extended-hours limit) order
          // and re-place as a market sell below. Otherwise the shares stay
          // held_for_orders and the position bleeds indefinitely.
          if (!isExtendedHours() && this.assetClass !== 'crypto') {
            try {
              await cancelOrder(pendingSellOrdersMap[pos.symbol].id);
              this.logEvent(`Canceled stale pending sell for ${pos.symbol} (order ${pendingSellOrdersMap[pos.symbol].id.substring(0, 8)}...) to re-exit at market.`, 'warning');
            } catch {
              // order may have filled/expired already
            }
            // fall through — risk checks below will place a fresh market sell
          } else {
            // Extended hours: wait for fill or expiry naturally
            if (shouldLog) {
              this.logEvent(`Sell already pending for ${pos.symbol} (order ${pendingSellOrdersMap[pos.symbol].id.substring(0, 8)}...) — waiting for fill or expiry.`, 'info');
            }
            continue;
          }
        }

        if (!marketOpen && this.assetClass !== 'crypto') continue; // Market closed — monitor only, don't trade

        // Previous sell attempt expired/failed during extended hours — don't retry.
        // Wait for regular session when market orders fill reliably.
        if (this.assetClass !== 'crypto' && expiredSellOrdersMap[pos.symbol] && !isMarketOpenOrOpeningSoon(this.assetClass)) {
          if (shouldLog) {
            this.logEvent(`Previous sell for ${pos.symbol} expired. Waiting for regular session to retry.`, 'info');
          }
          continue;
        }

        if (this.assetClass !== 'crypto' && expiredSellOrdersMap[pos.symbol] && !isMarketOpenOrOpeningSoon(this.assetClass)) {
          if (shouldLog) {
            this.logEvent(`Order for ${pos.symbol} previously expired. Market is closed; waiting until market opens to recreate.`, 'info');
          }
          continue;
        }

        if (gainPercent >= scaleOutThreshold && !this.scaledOutMap[pos.symbol] && qty >= 2) {
          const scaleQty = Math.floor(qty / 2);
          const reasonNote = `Take Profit: (50% scale-out @ +${gainPercent.toFixed(2)}%)`;
          this.logEvent(`${reasonNote}: Selling ${scaleQty} of ${qty} shares of ${pos.symbol}.`, 'success');
          this.scaledOutMap[pos.symbol] = true;
          this.persistRiskState(pos.symbol);
          await this.executeSmartOrder(pos.symbol, scaleQty, 'sell', reasonNote);
          continue;
        }

        if (gainPercent >= 1.0 && (this.peakStallCountMap[pos.symbol] || 0) >= 3) {
          const reasonNote = `Peak Stall Exit: No new peak high for 90s @ +${gainPercent.toFixed(2)}%`;
          this.logEvent(`${reasonNote}. Selling remaining ${qty} shares.`, 'warning');
          delete this.highWaterMarkMap[pos.symbol];
          delete this.peakStallCountMap[pos.symbol];
          delete this.scaledOutMap[pos.symbol];
          this.clearRiskState(pos.symbol);
          await this.executeSmartOrder(pos.symbol, qty, 'sell', reasonNote);
          continue;
        }

        const effectiveTrailingStop = gainPercent >= scaleOutThreshold ? (effectiveTrailing / 3) : effectiveTrailing;
        if (currentPeak > avgEntryPrice && dropFromPeakPercent >= effectiveTrailingStop) {
          const reasonNote = `Tight Peak Trailing Stop: ${dropFromPeakPercent.toFixed(2)}% drop from peak $${currentPeak.toFixed(2)} (gain was +${gainPercent.toFixed(2)}%)`;
          this.logEvent(`${reasonNote}. Selling remaining ${qty} shares.`, 'warning');
          delete this.highWaterMarkMap[pos.symbol];
          delete this.peakStallCountMap[pos.symbol];
          delete this.scaledOutMap[pos.symbol];
          this.clearRiskState(pos.symbol);
          await this.executeSmartOrder(pos.symbol, qty, 'sell', reasonNote);
          continue;
        }

        if (gainPercent <= -effectiveStopLoss) {
          const reasonNote = `Stop Loss: ${gainPercent.toFixed(2)}% (≤ -${effectiveStopLoss}%)`;
          this.logEvent(`${reasonNote}. Selling.`, 'warning');
          delete this.highWaterMarkMap[pos.symbol];
          delete this.peakStallCountMap[pos.symbol];
          delete this.scaledOutMap[pos.symbol];
          this.clearRiskState(pos.symbol);
          await this.executeSmartOrder(pos.symbol, qty, 'sell', reasonNote);
          continue;
        }

        if (gainPercent >= effectiveTakeProfit) {
          const reasonNote = `Take Profit: +${gainPercent.toFixed(2)}% (≥ +${effectiveTakeProfit}%)`;
          this.logEvent(`${reasonNote}. Selling.`, 'success');
          delete this.highWaterMarkMap[pos.symbol];
          delete this.peakStallCountMap[pos.symbol];
          delete this.scaledOutMap[pos.symbol];
          this.clearRiskState(pos.symbol);
          await this.executeSmartOrder(pos.symbol, qty, 'sell', reasonNote);
        }
      }
    } catch (error: any) {
      this.logEvent(`Risk management error: ${error.message}`, 'error');
    }
  }

  public async runStrategyCycle(): Promise<void> {
    if (!this.isRunning) return;

    // Skip stock trading when market is closed (weekends / outside 3am-8pm ET)
    if (this.assetClass === 'us_equity' && !isMarketOpenOrOpeningSoon('us_equity')) {
      return;
    }

    this.logEvent(`Strategy cycle (${this.currentConfig.strategy.toUpperCase()})`);

    try {
      const account = await getAccount();
      if (account.trading_blocked || account.account_blocked) {
        this.logEvent('Account trading is blocked by Alpaca. Skipping cycle.', 'warning');
        return;
      }

      // Today's realized P/L gates volatile-stock exposure (house money).
      const todayRealizedPl = await getTodayRealizedPl();
      const memeBudget = Math.max(0, todayRealizedPl * MEME_PROFIT_SHARE);
      this.logEvent(`Profit gate: today realized $${todayRealizedPl.toFixed(2)}, volatile budget $${memeBudget.toFixed(2)}`, 'info');

      const positions = await getPositions();
      const openOrders = await getOrders('open', 50);

      // Regular session: cancel any stale limit orders left over from extended
      // hours. During regular hours the bot uses market orders, so any open
      // limit order is a leftover that would otherwise hold shares hostage.
      if (this.assetClass === 'us_equity' && !isExtendedHours() && Array.isArray(openOrders)) {
        for (const o of openOrders) {
          if (o.type === 'limit') {
            try {
              await cancelOrder(o.id);
              this.logEvent(`Canceled stale limit order ${o.id.substring(0, 8)} for ${o.symbol} at market open.`, 'warning');
            } catch {
              // order may have filled/expired already
            }
          }
        }
      }

      const positionMap: Record<string, any> = {};
      if (Array.isArray(positions)) positions.forEach(p => {
        positionMap[p.symbol] = p;
        // Also index by normalized symbol for crypto matching (LTCUSD -> LTC/USD)
        positionMap[matchKey(p.symbol)] = p;
      });

      const pendingBuyOrdersMap: Record<string, any> = {};
      if (Array.isArray(openOrders)) {
        openOrders.forEach(o => {
          if (o.side === 'buy') {
            pendingBuyOrdersMap[o.symbol] = o;
            pendingBuyOrdersMap[matchKey(o.symbol)] = o;
          }
        });
      }

      // Dynamic universe — scan what's actually moving, not a curated watchlist.
      const activeWatchlist = this.assetClass === 'crypto'
        ? await getTopCryptoMovers()
        : await getTopMovers();

      if (this.assetClass === 'crypto' || !isExtendedHours()) {
        const sentiments = await analyzeNewsSentiment(activeWatchlist, true);

        const topBullish = sentiments.find(s => s.score >= 0.15);
        const topBearish = sentiments.find(s => s.score <= -0.15);

        if (topBullish && !(this.assetClass === 'crypto' && DISABLE_CRYPTO_BUYS)) {
          this.logEvent(`News: ${topBullish.symbol} +${topBullish.score} — "${topBullish.topHeadline}"`, 'success');

          const now = Date.now();
          const lastBuyTime = this.lastBuyTimeMap[topBullish.symbol] || 0;
          const isCoolingDown = (now - lastBuyTime) < BUY_COOLDOWN_MS;
          const lastSellTime = this.lastSellTimeMap[topBullish.symbol] || 0;
          const recentlySold = (now - lastSellTime) < this.REENTRY_COOLDOWN_MS;

          if (!positionMap[topBullish.symbol] && !pendingBuyOrdersMap[topBullish.symbol] && !isCoolingDown && !recentlySold) {
            this.lastBuyTimeMap[topBullish.symbol] = now;
            this.persistRiskState(topBullish.symbol);
            const price = await getCurrentPrice(topBullish.symbol) || 0;
            const availableCash = parseFloat(account.cash || '0');
            const qty = await calculatePositionSize(topBullish.symbol, price, topBullish.score, topBullish.headlines, availableCash, 1, this.assetClass);
            if (qty > 0) {
              const reasonNote = `News Sentiment (${topBullish.score >= 0 ? '+' : ''}${topBullish.score.toFixed(2)}): ${topBullish.topHeadline}`;
              this.logEvent(`Buying ${qty} ${topBullish.symbol} on news sentiment using liquid cash.`, 'success');
              await this.executeSmartOrder(topBullish.symbol, qty, 'buy', reasonNote);
            }
          }
        }

        if (topBearish) {
          if (pendingBuyOrdersMap[topBearish.symbol]) {
            this.logEvent(`News bearish: canceling pending buy ${pendingBuyOrdersMap[topBearish.symbol].id}.`, 'warning');
            await cancelOrder(pendingBuyOrdersMap[topBearish.symbol].id);
          }
          if (positionMap[topBearish.symbol]) {
            const pendingSells = await getOrders('open', 50);
            const hasPendingSell = Array.isArray(pendingSells) && pendingSells.some(o => o.side === 'sell' && o.symbol === topBearish.symbol);
            if (!hasPendingSell) {
              const reasonNote = `News Bearish (${topBearish.score.toFixed(2)}): ${topBearish.topHeadline}`;
              this.logEvent(`News bearish: selling held ${topBearish.symbol}.`, 'warning');
              delete this.highWaterMarkMap[topBearish.symbol];
              this.clearRiskState(topBearish.symbol);
              await this.executeSmartOrder(topBearish.symbol, Math.abs(parseFloat(positionMap[topBearish.symbol].qty)), 'sell', reasonNote);
            }
          }
        }
      }

      const techSignals = await analyzeWatchlist(activeWatchlist);

      let techBuysThisCycle = 0;
      let memeSpentThisCycle = 0;
      const MAX_TECH_BUYS_PER_CYCLE = 2;

      for (const signal of techSignals) {
        if (signal.confidence < TECH_MIN_CONFIDENCE) continue;

        if (signal.action === 'BUY' && !positionMap[signal.symbol] && !pendingBuyOrdersMap[signal.symbol]) {
          if (this.assetClass === 'crypto' && DISABLE_CRYPTO_BUYS) continue; // sell-only mode for crypto
          if (techBuysThisCycle >= MAX_TECH_BUYS_PER_CYCLE) break;
          const now = Date.now();
          const lastTechBuy = this.lastBuyTimeMap[signal.symbol] || 0;
          if ((now - lastTechBuy) < BUY_COOLDOWN_MS) continue;
          const lastSellTime = this.lastSellTimeMap[signal.symbol] || 0;
          if ((now - lastSellTime) < this.REENTRY_COOLDOWN_MS) continue;

          // Crypto: skip if price is already dropping (prevents buying into downtrend)
          if (this.assetClass === 'crypto' && signal.indicators.priceChange5min <= 0.5) continue;
          this.lastBuyTimeMap[signal.symbol] = now;
          this.persistRiskState(signal.symbol);

          const reasonNote = `Technical BUY (${signal.reason})`;
          const price = await getCurrentPrice(signal.symbol) || 0;
          const availableCash = parseFloat(account.cash || '0');

          const atrPct = signal.indicators.atrPct || 0;
          const isVolatile = atrPct > VOLATILE_ATR_PCT;

          let qty = 0;
          if (isVolatile) {
            // Volatile/meme stock: profit-gated + volatility-scaled.
            if (memeBudget <= 0) {
              this.logEvent(`Skip ${signal.symbol}: volatile (ATR ${atrPct}%) but no realized profit budget`, 'info');
              continue;
            }
            qty = volatilitySizedQty(price, atrPct);
            const notional = qty * price;
            if (memeSpentThisCycle + notional > memeBudget) {
              this.logEvent(`Skip ${signal.symbol}: volatile budget exhausted (spent $${memeSpentThisCycle.toFixed(0)} of $${memeBudget.toFixed(0)})`, 'info');
              continue;
            }
            memeSpentThisCycle += notional;
            this.logEvent(`Volatile entry ${signal.symbol} (ATR ${atrPct}%): ${qty} sh @ $${price.toFixed(2)} = $${notional.toFixed(0)}`, 'success');
          } else {
            qty = await calculatePositionSize(signal.symbol, price, signal.confidence, [signal.reason], availableCash, 1, this.assetClass);
          }

          this.logEvent(`Technical: ${signal.symbol} ${signal.reason} (confidence: ${signal.confidence})`, 'success');
          if (qty > 0) {
            await this.executeSmartOrder(signal.symbol, qty, 'buy', reasonNote);
            techBuysThisCycle++;
          }
        } else if (signal.action === 'SELL' && positionMap[signal.symbol]) {
          const reasonNote = `Technical SELL (${signal.reason})`;
          this.logEvent(`Technical sell: ${signal.symbol} ${signal.reason} (confidence: ${signal.confidence})`, 'warning');
          delete this.highWaterMarkMap[signal.symbol];
          this.clearRiskState(signal.symbol);
          try {
            await this.executeSmartOrder(signal.symbol, Math.abs(parseFloat(positionMap[signal.symbol].qty)), 'sell', reasonNote);
          } catch (sellErr: any) {
            this.logEvent(`Technical sell skipped (position likely already closed): ${signal.symbol}`, 'warning');
          }
        }
      }

      // ── T-bill Cash Sweep ────────────────────────────────────────
      // Park spare cash in T-bill ETFs (SGOV/BIL/USFR) for yield. These are
      // long-term holds — risk management never stop-losses them.
      if (this.assetClass === 'us_equity') {
        const totalPortfolioValue = parseFloat(account.equity || '0');
        const cashOnHand = parseFloat(account.cash || '0');
        const cashPct = totalPortfolioValue > 0 ? (cashOnHand / totalPortfolioValue) * 100 : 0;

        // Current T-bill exposure (market value of held cash-equivalent ETFs)
        const tbillValue = Object.values(positionMap)
          .filter(p => CASH_EQUIVALENT_TICKERS.includes(p.symbol))
          .reduce((sum, p) => sum + (parseFloat(p.market_value) || 0), 0);
        const tbillPct = totalPortfolioValue > 0 ? (tbillValue / totalPortfolioValue) * 100 : 0;

        if (cashPct >= TBILL_CASH_MIN_PCT && tbillPct < TBILL_ALLOCATION_PCT * 100) {
          for (const ticker of CASH_EQUIVALENT_TICKERS) {
            if (positionMap[ticker]) continue;
            const now = Date.now();
            const lastBuy = this.lastBuyTimeMap[ticker] || 0;
            if ((now - lastBuy) < INDEX_COOLDOWN_MS) continue;

            const price = await getCurrentPrice(ticker) || 0;
            if (price <= 0) continue;

            const allocationCash = cashOnHand * TBILL_BUY_PCT;
            const qty = Math.floor(allocationCash / price);
            if (qty < 1) continue;

            this.lastBuyTimeMap[ticker] = now;
            this.persistRiskState(ticker);
            const reasonNote = `T-bill sweep: ${cashPct.toFixed(0)}% cash idle, parking in ${ticker} for yield`;
            this.logEvent(reasonNote, 'success');
            await this.executeSmartOrder(ticker, qty, 'buy', reasonNote);
            break; // max 1 T-bill buy per cycle
          }
        }
      }

      // ── Index Accumulation Fallback ───────────────────────────────
      // When no active positions in individual stocks and cash is piling up,
      // accumulate S&P 500 / Nasdaq ETFs for long-term index growth.
      if (this.assetClass === 'us_equity') {
        const totalPortfolioValue = parseFloat(account.equity || '0');
        const cashOnHand = parseFloat(account.cash || '0');
        const cashPct = totalPortfolioValue > 0 ? (cashOnHand / totalPortfolioValue) * 100 : 0;

        if (cashPct >= INDEX_CASH_MIN_PCT) {
          let indexBoughtThisCycle = false;
          for (const indexTicker of INDEX_ACCUMULATION_TICKERS) {
            if (indexBoughtThisCycle) break; // max 1 index buy per cycle
            // Skip if already holding or have a pending buy
            if (positionMap[indexTicker]) continue;

            const now = Date.now();
            const lastIndexBuy = this.lastBuyTimeMap[indexTicker] || 0;
            if ((now - lastIndexBuy) < INDEX_COOLDOWN_MS) continue;

            const price = await getCurrentPrice(indexTicker) || 0;
            if (price <= 0) continue;

            // Allocate 15% of cash per index ticker (max ~30% combined for SPY+QQQ)
            const allocationCash = cashOnHand * 0.15;
            const qty = Math.floor(allocationCash / price);
            if (qty < 1) continue;

            this.lastBuyTimeMap[indexTicker] = now;
            this.persistRiskState(indexTicker);
            indexBoughtThisCycle = true;
            const reasonNote = `Index Accumulation: ${cashPct.toFixed(0)}% cash idle, buying ${indexTicker} for long-term growth`;
            this.logEvent(reasonNote, 'success');
            await this.executeSmartOrder(indexTicker, qty, 'buy', reasonNote);
          }
        }
      }
    } catch (error: any) {
      this.logEvent(`Strategy cycle error: ${error.message}`, 'error');
    }
  }

  public start(config: Partial<BotConfig> = {}, startingEquity?: number): BotStatus {
    if (this.isRunning) {
      this.logEvent('Bot is already running.', 'warning');
      return this.getStatus();
    }

    this.currentConfig = { ...this.currentConfig, ...config, ...this.defaultRiskParams, assetClass: this.assetClass };
    this.isRunning = true;

    saveBotStateDb(true, this.currentConfig, getAccountMode(), startingEquity);
    this.restoreRiskState();
    this.logEvent(`Started — assetClass=${this.assetClass.toUpperCase()}, strategy=${this.currentConfig.strategy.toUpperCase()}`);

    this.runRiskManagement();
    this.riskInterval = setInterval(() => this.runRiskManagement(), RISK_CHECK_SECONDS * 1000);

    this.runStrategyCycle();
    this.strategyInterval = setInterval(() => this.runStrategyCycle(), this.currentConfig.intervalSeconds * 1000);

    return this.getStatus();
  }

  public stop(): BotStatus {
    if (!this.isRunning) {
      this.logEvent('Bot is not currently running.', 'warning');
      return this.getStatus();
    }

    if (this.riskInterval) { clearInterval(this.riskInterval); this.riskInterval = null; }
    if (this.strategyInterval) { clearInterval(this.strategyInterval); this.strategyInterval = null; }
    this.isRunning = false;

    saveBotStateDb(false, this.currentConfig, getAccountMode());
    this.logEvent('Bot stopped.');
    return this.getStatus();
  }

  public getStatus(): BotStatus {
    return { isRunning: this.isRunning, config: this.currentConfig, logs: this.botLogs };
  }
}

export const stockBot = new BotEngine('us_equity', DEFAULT_STOCK_CONFIG);
export const cryptoBot = new BotEngine('crypto', DEFAULT_CRYPTO_CONFIG);

export function getBotInstance(assetClass: 'us_equity' | 'crypto' = 'us_equity'): BotEngine {
  return assetClass === 'crypto' ? cryptoBot : stockBot;
}

export function startBot(config: Partial<BotConfig> = {}, startingEquity?: number): BotStatus {
  const targetAssetClass = config.assetClass || 'us_equity';
  const instance = getBotInstance(targetAssetClass);
  return instance.start(config, startingEquity);
}

export function stopBot(assetClass: 'us_equity' | 'crypto' = 'us_equity'): BotStatus {
  return getBotInstance(assetClass).stop();
}

export function getBotStatus(assetClass: 'us_equity' | 'crypto' = 'us_equity'): BotStatus {
  return getBotInstance(assetClass).getStatus();
}

export function getAllBotsStatus(): { stockBot: BotStatus; cryptoBot: BotStatus } {
  return {
    stockBot: stockBot.getStatus(),
    cryptoBot: cryptoBot.getStatus()
  };
}

export function restoreBotStateOnBoot(): void {
  const mode = getAccountMode();
  const stockSaved = getBotStateDb(mode, 'us_equity');
  if (stockSaved.isRunning) {
    stockBot.logEvent('Previous Stock Bot state was RUNNING. Resuming Stock Bot on boot...');
    stockBot.start(stockSaved.config || {});
  } else {
    stockBot.logEvent('Previous Stock Bot state was STOPPED. Remaining STOPPED on boot.');
  }

  const cryptoSaved = getBotStateDb(mode, 'crypto');
  if (cryptoSaved.isRunning) {
    cryptoBot.logEvent('Previous Crypto Bot state was RUNNING. Resuming Crypto Bot on boot...');
    cryptoBot.start(cryptoSaved.config || {});
  } else {
    cryptoBot.logEvent('Previous Crypto Bot state was STOPPED. Remaining STOPPED on boot.');
  }
}
