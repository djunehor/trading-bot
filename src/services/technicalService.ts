import { alpacaService } from './alpacaService.js';
import { Logger } from './logger.js';
import { MarketClock } from './marketClock.js';

export interface Bar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface TechnicalSignal {
  symbol: string;
  action: 'BUY' | 'HOLD' | 'SELL';
  confidence: number; // 0.0 – 1.0
  reason: string;
  indicators: {
    volumeWeightedAvgPrice: number;
    movingAvg20: number;
    movingAvg50: number | null;
    relativeStrengthIndex: number;
    bollingerLower: number;
    bollingerUpper: number;
    volumeRatio: number;
    priceChangePct5Min: number;
    belowVwap: boolean;
    averageTrueRange: number;
    averageTrueRangePct: number;
  };
}

interface SignalContext {
  symbol: string;
  bars: Bar[];
  dailyBars: Bar[];
  closes: number[];
  currentPrice: number;
  previousPrice: number;
  priceChangePct5Min: number;
  volumeWeightedAvgPrice: number;
  movingAvg20: number;
  movingAvg50: number | null;
  relativeStrengthIndex: number;
  volumeRatio: number;
  avgVol: number;
  indicators: TechnicalSignal['indicators'];
}

export class TechnicalService {
  simpleMovingAverage(prices: number[], period: number): number {
    if (prices.length < period) {
      return prices[prices.length - 1];
    }
    const slice = prices.slice(-period);
    return slice.reduce((sum, price) => sum + price, 0) / period;
  }

  exponentialMovingAverage(prices: number[], period: number): number {
    if (prices.length < 2) {
      return prices[0];
    }
    const smoothingFactor = 2 / (period + 1);
    let emaValue = prices[0];
    for (let i = 1; i < prices.length; i++) {
      emaValue = prices[i] * smoothingFactor + emaValue * (1 - smoothingFactor);
    }
    return emaValue;
  }

  relativeStrengthIndex(prices: number[], period = 14): number {
    if (prices.length < period + 1) {
      return 50;
    }
    let gains = 0,
      losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
      const delta = prices[i] - prices[i - 1];
      if (delta >= 0) {
        gains += delta;
      } else {
        losses -= delta;
      }
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) {
      return 100;
    }
    return 100 - 100 / (1 + avgGain / avgLoss);
  }

  averageTrueRange(bars: Bar[], period = 14): number {
    if (bars.length < period + 1) {
      return 0;
    }
    let total = 0;
    for (let i = bars.length - period; i < bars.length; i++) {
      const high = bars[i].h;
      const low = bars[i].l;
      const previousClose = bars[i - 1].c;
      const trueRange = Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
      total += trueRange;
    }
    return total / period;
  }

  bollingerBands(prices: number[], period = 20, multiplier = 2): { lower: number; upper: number } {
    const mid = this.simpleMovingAverage(prices, period);
    const slice = prices.slice(-period);
    const variance = slice.reduce((sum, price) => sum + (price - mid) ** 2, 0) / period;
    const stddev = Math.sqrt(variance);
    return { lower: mid - multiplier * stddev, upper: mid + multiplier * stddev };
  }

  volumeWeightedAveragePrice(bars: Bar[]): number {
    let cumulativePriceVolume = 0,
      cumulativeVolume = 0;
    for (const bar of bars) {
      const typicalPrice = (bar.h + bar.l + bar.c) / 3;
      cumulativePriceVolume += typicalPrice * bar.v;
      cumulativeVolume += bar.v;
    }
    return cumulativeVolume > 0 ? cumulativePriceVolume / cumulativeVolume : 0;
  }

  async analyzeTechnical(symbol: string): Promise<TechnicalSignal | null> {
    const context = await this.buildSignalContext(symbol);
    if (!context) {
      return null;
    }

    for (const detect of this.signalDetectors) {
      const signal = detect(context);
      if (signal) {
        return signal;
      }
    }

    return { symbol, action: 'HOLD', confidence: 0, reason: 'No clear signal', indicators: context.indicators };
  }

  async analyzeWatchlist(symbols: string[]): Promise<TechnicalSignal[]> {
    const results: TechnicalSignal[] = [];
    for (const sym of symbols) {
      try {
        const signal = await this.analyzeTechnical(sym);
        if (signal && signal.action !== 'HOLD') {
          results.push(signal);
          Logger.info(`Technical: ${signal.action} ${sym} (${signal.confidence}) — ${signal.reason}`);
        }
      } catch {
        Logger.warn('Failed to analyze watchlist symbol.');
      }
    }
    results.sort((left, right) => right.confidence - left.confidence);
    return results;
  }

  private async fetchBars(symbol: string): Promise<Bar[]> {
    // Detect crypto: slash in symbol, or a known no-slash format (e.g. BTCUSD → BTC/USD)
    const isCrypto = symbol.includes('/') || /^[A-Z]{2,6}(USD|USDT|BTC|ETH)$/i.test(symbol);
    const formattedSym = symbol.includes('/') ? symbol : isCrypto ? symbol.replace(/^(.*?)(USD|USDT|BTC|ETH)$/i, '$1/$2') : symbol;

    const url = isCrypto
      ? `https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(formattedSym)}&timeframe=5Min&limit=60&sort=desc`
      : `https://data.alpaca.markets/v2/stocks/${symbol}/bars?timeframe=5Min&limit=60&sort=desc`;

    try {
      const response = await fetch(url, {
        headers: {
          'APCA-API-KEY-ID': process.env.ALPACA_PAPER_KEY_ID || process.env.ALPACA_LIVE_KEY_ID || '',
          'APCA-API-SECRET-KEY': process.env.ALPACA_PAPER_SECRET_KEY || process.env.ALPACA_LIVE_SECRET_KEY || '',
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as { bars?: Bar[] | Record<string, Bar[]> };

      if (isCrypto) {
        const cryptoBars = (data.bars as Record<string, Bar[]>)?.[formattedSym] || [];
        return [...cryptoBars].reverse();
      }

      const stockBars = (data.bars as Bar[]) || [];
      return [...stockBars].reverse(); // oldest first
    } catch (error) {
      Logger.warn(`Failed to fetch bars for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  /**
   * Daily bars for gap / 52-week-high strategies (stocks only).
   */
  private async fetchDailyBars(symbol: string, limit = 260): Promise<Bar[]> {
    if (symbol.includes('/')) {
      return [];
    } // crypto — skip daily strategies
    const url = `https://data.alpaca.markets/v2/stocks/${symbol}/bars?timeframe=1Day&limit=${limit}&sort=desc`;
    try {
      const response = await fetch(url, {
        headers: {
          'APCA-API-KEY-ID': process.env.ALPACA_PAPER_KEY_ID || process.env.ALPACA_LIVE_KEY_ID || '',
          'APCA-API-SECRET-KEY': process.env.ALPACA_PAPER_SECRET_KEY || process.env.ALPACA_LIVE_SECRET_KEY || '',
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as { bars?: Bar[] };
      return [...(data.bars || [])].reverse(); // oldest first
    } catch (error) {
      Logger.warn(`Failed to fetch daily bars for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private async buildSignalContext(symbol: string): Promise<SignalContext | null> {
    const bars = await this.fetchBars(symbol);
    if (bars.length < 20) {
      return null;
    }

    const closes = bars.map((bar) => bar.c);
    const volumes = bars.map((bar) => bar.v);
    // Real-time price for ALL signal decisions — never use the stale bar close.
    const realTimePrice = await alpacaService.getCurrentPrice(symbol);
    const currentPrice = realTimePrice === null ? closes[closes.length - 1] : realTimePrice;
    const previousPrice = closes[closes.length - 2] || currentPrice;
    const priceChangePct5Min = ((currentPrice - previousPrice) / previousPrice) * 100;

    const vwapValue = this.volumeWeightedAveragePrice(bars);
    const movingAvg20Value = this.simpleMovingAverage(closes, 20);
    const movingAvg50Value = closes.length >= 50 ? this.simpleMovingAverage(closes, 50) : null;
    const rsiValue = this.relativeStrengthIndex(closes, 14);
    const bands = this.bollingerBands(closes, 20, 2);
    const avgVol = volumes.slice(-20).reduce((sum, volume) => sum + volume, 0) / 20;
    const lastVol = volumes[volumes.length - 1] || 0;
    const volumeRatio = avgVol > 0 ? lastVol / avgVol : 1;
    const atrValue = this.averageTrueRange(bars, 14);
    const averageTrueRangePct = currentPrice > 0 ? (atrValue / currentPrice) * 100 : 0;

    const indicators: TechnicalSignal['indicators'] = {
      volumeWeightedAvgPrice: Math.round(vwapValue * 100) / 100,
      movingAvg20: Math.round(movingAvg20Value * 100) / 100,
      movingAvg50: movingAvg50Value ? Math.round(movingAvg50Value * 100) / 100 : null,
      relativeStrengthIndex: Math.round(rsiValue * 100) / 100,
      bollingerLower: Math.round(bands.lower * 100) / 100,
      bollingerUpper: Math.round(bands.upper * 100) / 100,
      volumeRatio: Math.round(volumeRatio * 100) / 100,
      priceChangePct5Min: Math.round(priceChangePct5Min * 100) / 100,
      belowVwap: currentPrice < vwapValue,
      averageTrueRange: Math.round(atrValue * 100) / 100,
      averageTrueRangePct: Math.round(averageTrueRangePct * 100) / 100,
    };

    const dailyBars = await this.fetchDailyBars(symbol, 260);

    return {
      symbol,
      bars,
      dailyBars,
      closes,
      currentPrice,
      previousPrice,
      priceChangePct5Min,
      volumeWeightedAvgPrice: vwapValue,
      movingAvg20: movingAvg20Value,
      movingAvg50: movingAvg50Value,
      relativeStrengthIndex: rsiValue,
      volumeRatio,
      avgVol,
      indicators,
    };
  }

  private detectSustainedUptrend(context: SignalContext): TechnicalSignal | null {
    const { bars } = context;
    if (bars.length < 24) {
      return null;
    }

    const twoHourBars = bars.slice(-24); // 24 bars × 5min = 2 hours
    const startPrice = twoHourBars[0].c;
    const change2h = ((context.currentPrice - startPrice) / startPrice) * 100;
    const upBars = twoHourBars.filter((bar) => bar.c > bar.o).length;
    const upRatio = upBars / twoHourBars.length;
    const twoHourAvgVol = twoHourBars.reduce((sum, bar) => sum + bar.v, 0) / twoHourBars.length;
    const volumeSupport = context.avgVol > 0 ? twoHourAvgVol / context.avgVol : 1;

    // Gain 1%–8% over 2h (not parabolic), mostly green bars, above VWAP, healthy volume
    if (
      change2h >= 1 &&
      change2h <= 8 &&
      upRatio >= 0.6 &&
      context.currentPrice >= context.volumeWeightedAvgPrice &&
      volumeSupport >= 0.8
    ) {
      return {
        symbol: context.symbol,
        action: 'BUY',
        confidence: 0.8,
        reason: `Sustained 2h uptrend: +${change2h.toFixed(1)}% (${Math.round(upRatio * 100)}% green bars), above VWAP`,
        indicators: context.indicators,
      };
    }
    return null;
  }

  private detectOpeningRangeBreakout(context: SignalContext): TechnicalSignal | null {
    const { bars } = context;
    const minutesSinceMidnight = MarketClock.minutesSinceMidnightNY();
    const isInOpeningWindow =
      minutesSinceMidnight >= MarketClock.REGULAR_OPEN_MINUTES && minutesSinceMidnight <= MarketClock.OPENING_RANGE_END_MINUTES;
    if (bars.length < 6 || !isInOpeningWindow) {
      return null;
    }

    const lastBarDay = new Date(bars[bars.length - 1].t).toISOString().slice(0, 10);
    const todayBars = bars.filter((bar) => new Date(bar.t).toISOString().slice(0, 10) === lastBarDay);
    if (todayBars.length < 6) {
      return null;
    }

    const first6 = todayBars.slice(0, 6); // first 30 min
    const openRangeHigh = Math.max(...first6.map((bar) => bar.h));
    const openRangeLow = Math.min(...first6.map((bar) => bar.l));
    const rangeSize = openRangeHigh - openRangeLow;

    // Breakout above range high with volume confirmation
    if (context.currentPrice > openRangeHigh && rangeSize > 0 && context.volumeRatio >= 1.2) {
      return {
        symbol: context.symbol,
        action: 'BUY',
        confidence: 0.75,
        reason: `Opening range breakout: broke above 30min high $${openRangeHigh.toFixed(2)} on ${context.volumeRatio.toFixed(1)}x volume`,
        indicators: context.indicators,
      };
    }
    return null;
  }

  private detect52WeekHigh(context: SignalContext): TechnicalSignal | null {
    const { dailyBars } = context;
    if (dailyBars.length < 2) {
      return null;
    }

    const yearHigh = Math.max(...dailyBars.map((bar) => bar.h));
    const pctFromHigh = ((context.currentPrice - yearHigh) / yearHigh) * 100;
    if (pctFromHigh >= -1 && pctFromHigh <= 3 && context.currentPrice > context.volumeWeightedAvgPrice) {
      return {
        symbol: context.symbol,
        action: 'BUY',
        confidence: 0.7,
        reason: `52-week high breakout: ${pctFromHigh >= 0 ? '+' : ''}${pctFromHigh.toFixed(2)}% vs high $${yearHigh.toFixed(2)}`,
        indicators: context.indicators,
      };
    }
    return null;
  }

  private detectGapAndGo(context: SignalContext): TechnicalSignal | null {
    const { dailyBars } = context;
    if (dailyBars.length < 2) {
      return null;
    }

    const yesterdayClose = dailyBars[dailyBars.length - 2].c;
    const todayOpen = dailyBars[dailyBars.length - 1].o;
    const gapPct = ((todayOpen - yesterdayClose) / yesterdayClose) * 100;
    const runningFromOpen = ((context.currentPrice - todayOpen) / todayOpen) * 100;
    if (gapPct >= 1 && gapPct <= 10 && runningFromOpen >= 0 && context.volumeRatio >= 1) {
      return {
        symbol: context.symbol,
        action: 'BUY',
        confidence: 0.68,
        reason: `Gap-and-go: +${gapPct.toFixed(1)}% gap, holding ${runningFromOpen >= 0 ? '+' : ''}${runningFromOpen.toFixed(1)}% above open`,
        indicators: context.indicators,
      };
    }
    return null;
  }

  private detectMomentumBreakout(context: SignalContext): TechnicalSignal | null {
    if (
      context.currentPrice > context.volumeWeightedAvgPrice &&
      context.relativeStrengthIndex >= 55 &&
      context.relativeStrengthIndex <= 75 &&
      context.priceChangePct5Min >= 0.5 &&
      context.volumeRatio >= 1.3
    ) {
      return {
        symbol: context.symbol,
        action: 'BUY',
        confidence: 0.7,
        reason: `Momentum breakout: +${context.priceChangePct5Min.toFixed(1)}% surge, RSI ${context.relativeStrengthIndex.toFixed(0)}, ${context.volumeRatio.toFixed(1)}x volume, above VWAP`,
        indicators: context.indicators,
      };
    }
    return null;
  }

  private detectRsiDivergence(context: SignalContext): TechnicalSignal | null {
    const { closes } = context;
    if (closes.length < 30) {
      return null;
    }

    const lookback = 20;
    const recentCloses = closes.slice(-lookback);
    const firstLow = Math.min(...recentCloses.slice(0, 10));
    const secondLow = Math.min(...recentCloses.slice(10));
    const firstLowIndex = recentCloses.slice(0, 10).indexOf(firstLow);
    const secondLowIndex = 10 + recentCloses.slice(10).indexOf(secondLow);
    const rsiAtFirstLow = this.relativeStrengthIndex(closes.slice(0, closes.length - lookback + firstLowIndex + 1), 14);
    const rsiAtSecondLow = this.relativeStrengthIndex(closes.slice(0, closes.length - lookback + secondLowIndex + 1), 14);
    if (secondLow < firstLow && rsiAtSecondLow - rsiAtFirstLow >= 3 && context.relativeStrengthIndex < 50) {
      return {
        symbol: context.symbol,
        action: 'BUY',
        confidence: 0.62,
        reason: `RSI bullish divergence: lower low $${secondLow.toFixed(2)} but RSI ${rsiAtSecondLow.toFixed(0)} > ${rsiAtFirstLow.toFixed(0)}`,
        indicators: context.indicators,
      };
    }
    return null;
  }

  private detectGoldenCross(context: SignalContext): TechnicalSignal | null {
    if (
      context.movingAvg50 &&
      context.movingAvg20 > context.movingAvg50 &&
      context.currentPrice > context.volumeWeightedAvgPrice &&
      context.relativeStrengthIndex > 40 &&
      context.relativeStrengthIndex < 70
    ) {
      return {
        symbol: context.symbol,
        action: 'BUY',
        confidence: 0.55,
        reason: `Golden cross: SMA20 $${context.movingAvg20.toFixed(2)} > SMA50 $${context.movingAvg50.toFixed(2)}, above VWAP`,
        indicators: context.indicators,
      };
    }
    return null;
  }

  private detectVwapBreakdown(context: SignalContext): TechnicalSignal | null {
    if (
      context.previousPrice > context.volumeWeightedAvgPrice &&
      context.currentPrice < context.volumeWeightedAvgPrice &&
      context.volumeRatio > 1.2
    ) {
      return {
        symbol: context.symbol,
        action: 'SELL',
        confidence: 0.6,
        reason: `VWAP breakdown: crossed below VWAP on ${context.volumeRatio.toFixed(1)}x volume`,
        indicators: context.indicators,
      };
    }
    return null;
  }

  private detectRsiOverbought(context: SignalContext): TechnicalSignal | null {
    if (context.relativeStrengthIndex > 75 && context.priceChangePct5Min < 0) {
      return {
        symbol: context.symbol,
        action: 'SELL',
        confidence: 0.55,
        reason: `RSI overbought: RSI ${context.relativeStrengthIndex.toFixed(0)}, ${context.priceChangePct5Min.toFixed(1)}% pull`,
        indicators: context.indicators,
      };
    }
    return null;
  }

  private readonly signalDetectors: ((context: SignalContext) => TechnicalSignal | null)[] = [
    this.detectSustainedUptrend.bind(this),
    this.detectOpeningRangeBreakout.bind(this),
    this.detect52WeekHigh.bind(this),
    this.detectGapAndGo.bind(this),
    this.detectMomentumBreakout.bind(this),
    this.detectRsiDivergence.bind(this),
    this.detectGoldenCross.bind(this),
    this.detectVwapBreakdown.bind(this),
    this.detectRsiOverbought.bind(this),
  ];
}

export const technicalService = new TechnicalService();
