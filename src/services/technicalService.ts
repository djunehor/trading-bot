import { getCurrentPrice } from './alpacaService.js';
import { createLogger } from './logger.js';

const log = createLogger('TechnicalService');

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
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;    // 0.0 – 1.0
  reason: string;
  indicators: {
    vwap: number;
    sma20: number;
    sma50: number | null;
    rsi: number;
    bollingerLower: number;
    bollingerUpper: number;
    volumeRatio: number;
    priceChange5min: number;
    belowVwap: boolean;
    atr: number;
    atrPct: number;
  };
}

// ── indicator math ───────────────────────────────────────────────────

function sma(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1];
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(prices: number[], period: number): number {
  if (prices.length < 2) return prices[0];
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function rsi(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const delta = prices[i] - prices[i - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function atr(bars: Bar[], period: number = 14): number {
  if (bars.length < period + 1) return 0;
  let total = 0;
  for (let i = bars.length - period; i < bars.length; i++) {
    const h = bars[i].h, l = bars[i].l, prevC = bars[i - 1].c;
    const tr = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
    total += tr;
  }
  return total / period;
}

function bollingerBands(prices: number[], period: number = 20, multiplier: number = 2): { lower: number; upper: number } {
  const mid = sma(prices, period);
  const slice = prices.slice(-period);
  const variance = slice.reduce((s, p) => s + (p - mid) ** 2, 0) / period;
  const stddev = Math.sqrt(variance);
  return { lower: mid - multiplier * stddev, upper: mid + multiplier * stddev };
}

function vwap(bars: Bar[]): number {
  let cumulativePV = 0, cumulativeV = 0;
  for (const bar of bars) {
    const typical = (bar.h + bar.l + bar.c) / 3;
    cumulativePV += typical * bar.v;
    cumulativeV += bar.v;
  }
  return cumulativeV > 0 ? cumulativePV / cumulativeV : 0;
}

// ── bar fetching ─────────────────────────────────────────────────────

async function fetchBars(symbol: string): Promise<Bar[]> {
  // Detect crypto: slash in symbol, or a known no-slash format (e.g. BTCUSD → BTC/USD)
  const isCrypto = symbol.includes('/') || /^[A-Z]{2,6}(USD|USDT|BTC|ETH)$/i.test(symbol);
  const formattedSym = symbol.includes('/') ? symbol : (isCrypto ? symbol.replace(/^(.*?)(USD|USDT|BTC|ETH)$/i, '$1/$2') : symbol);

  const url = isCrypto
    ? `https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(formattedSym)}&timeframe=5Min&limit=60&sort=desc`
    : `https://data.alpaca.markets/v2/stocks/${symbol}/bars?timeframe=5Min&limit=60&sort=desc`;

  try {
    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': process.env.ALPACA_PAPER_KEY_ID || process.env.ALPACA_LIVE_KEY_ID || '',
        'APCA-API-SECRET-KEY': process.env.ALPACA_PAPER_SECRET_KEY || process.env.ALPACA_LIVE_SECRET_KEY || '',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { bars?: Bar[] | Record<string, Bar[]> };

    if (isCrypto) {
      const cryptoBars = (data.bars as Record<string, Bar[]>)?.[formattedSym] || [];
      return cryptoBars.slice().reverse();
    }

    const stockBars = (data.bars as Bar[]) || [];
    return stockBars.slice().reverse(); // oldest first
  } catch (err: any) {
    log.warn(`Failed to fetch bars for ${symbol}: ${err.message}`);
    return [];
  }
}

// Daily bars for gap / 52-week-high strategies (stocks only)
async function fetchDailyBars(symbol: string, limit: number = 260): Promise<Bar[]> {
  if (symbol.includes('/')) return []; // crypto — skip daily strategies
  const url = `https://data.alpaca.markets/v2/stocks/${symbol}/bars?timeframe=1Day&limit=${limit}&sort=desc`;
  try {
    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': process.env.ALPACA_PAPER_KEY_ID || process.env.ALPACA_LIVE_KEY_ID || '',
        'APCA-API-SECRET-KEY': process.env.ALPACA_PAPER_SECRET_KEY || process.env.ALPACA_LIVE_SECRET_KEY || '',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { bars?: Bar[] };
    const bars = (data.bars || []).slice().reverse(); // oldest first
    return bars;
  } catch (err: any) {
    log.warn(`Failed to fetch daily bars for ${symbol}: ${err.message}`);
    return [];
  }
}

// ── signal generation ────────────────────────────────────────────────

export async function analyzeTechnical(symbol: string): Promise<TechnicalSignal | null> {
  const bars = await fetchBars(symbol);
  if (bars.length < 20) return null;

  const closes = bars.map(b => b.c);
  const volumes = bars.map(b => b.v);
  // Real-time price for ALL signal decisions — never use the stale bar close.
  const realTimePrice = await getCurrentPrice(symbol);
  const currentPrice = realTimePrice !== null ? realTimePrice : closes[closes.length - 1];
  const prevPrice = closes[closes.length - 2] || currentPrice;
  const price5minAgo = closes[closes.length - 2] || currentPrice;
  const priceChange5min = ((currentPrice - price5minAgo) / price5minAgo) * 100;

  const vwapVal = vwap(bars);
  const sma20Val = sma(closes, 20);
  const sma50Val = closes.length >= 50 ? sma(closes, 50) : null;
  const rsiVal = rsi(closes, 14);
  const bb = bollingerBands(closes, 20, 2);
  const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const lastVol = volumes[volumes.length - 1] || 0;
  const volumeRatio = avgVol > 0 ? lastVol / avgVol : 1;
  const atrVal = atr(bars, 14);
  const atrPct = currentPrice > 0 ? (atrVal / currentPrice) * 100 : 0;

  const indicators = {
    vwap: Math.round(vwapVal * 100) / 100,
    sma20: Math.round(sma20Val * 100) / 100,
    sma50: sma50Val ? Math.round(sma50Val * 100) / 100 : null,
    rsi: Math.round(rsiVal * 100) / 100,
    bollingerLower: Math.round(bb.lower * 100) / 100,
    bollingerUpper: Math.round(bb.upper * 100) / 100,
    volumeRatio: Math.round(volumeRatio * 100) / 100,
    priceChange5min: Math.round(priceChange5min * 100) / 100,
    belowVwap: currentPrice < vwapVal,
    atr: Math.round(atrVal * 100) / 100,
    atrPct: Math.round(atrPct * 100) / 100,
  };

  // Daily bars for gap / 52-week-high strategies (stocks only)
  const dailyBars = await fetchDailyBars(symbol, 260);

  // ── buy signals (ordered by confidence) ──────────────────────────

  // 0. Sustained uptrend: ~2 hours of consistent gains (the "momentum train").
  //    Joins a stock that's been rising steadily, not a parabolic spike.
  //    Trailing stop then locks in profit if it reverses.
  if (bars.length >= 24) {
    const twoHourBars = bars.slice(-24); // 24 bars × 5min = 2 hours
    const startPrice = twoHourBars[0].c;
    const change2h = ((currentPrice - startPrice) / startPrice) * 100;
    const upBars = twoHourBars.filter(b => b.c > b.o).length;
    const upRatio = upBars / twoHourBars.length;
    const twoHourAvgVol = twoHourBars.reduce((s, b) => s + b.v, 0) / twoHourBars.length;
    const volSupport = avgVol > 0 ? twoHourAvgVol / avgVol : 1;

    // Gain 1%–8% over 2h (not parabolic), mostly green bars, above VWAP, healthy volume
    if (change2h >= 1 && change2h <= 8 && upRatio >= 0.6 && currentPrice >= vwapVal && volSupport >= 0.8) {
      return {
        symbol, action: 'BUY', confidence: 0.8,
        reason: `Sustained 2h uptrend: +${change2h.toFixed(1)}% (${Math.round(upRatio * 100)}% green bars), above VWAP`,
        indicators,
      };
    }
  }

  // 0a. Opening range breakout: price breaks above the first 30 min high of the day
  //    Classic day-trading edge — early strength tends to continue.
  //    Only valid in the first ~2 hours after open (9:30–11:30 AM ET).
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const minutesSinceMidnight = nowET.getHours() * 60 + nowET.getMinutes();
  const inOpeningWindow = minutesSinceMidnight >= 9 * 60 + 30 && minutesSinceMidnight <= 11 * 60 + 30;
  if (bars.length >= 6 && inOpeningWindow) {
    const lastBarDay = new Date(bars[bars.length - 1].t).toISOString().slice(0, 10);
    const todayBars = bars.filter(b => new Date(b.t).toISOString().slice(0, 10) === lastBarDay);
    if (todayBars.length >= 6) {
      const first6 = todayBars.slice(0, 6); // first 30 min
      const openRangeHigh = Math.max(...first6.map(b => b.h));
      const openRangeLow = Math.min(...first6.map(b => b.l));
      const rangeSize = openRangeHigh - openRangeLow;
      // Breakout above range high with volume confirmation
      if (currentPrice > openRangeHigh && rangeSize > 0 && volumeRatio >= 1.2) {
        return {
          symbol, action: 'BUY', confidence: 0.75,
          reason: `Opening range breakout: broke above 30min high $${openRangeHigh.toFixed(2)} on ${volumeRatio.toFixed(1)}x volume`,
          indicators,
        };
      }
    }
  }

  // 0b. 52-week high breakout: price near or making a new 52-week high
  //    Strongest momentum signal — new highs attract buyers.
  if (dailyBars.length >= 2) {
    const yearHigh = Math.max(...dailyBars.map(b => b.h));
    const pctFromHigh = ((currentPrice - yearHigh) / yearHigh) * 100;
    if (pctFromHigh >= -1 && pctFromHigh <= 3 && currentPrice > vwapVal) {
      return {
        symbol, action: 'BUY', confidence: 0.7,
        reason: `52-week high breakout: ${pctFromHigh >= 0 ? '+' : ''}${pctFromHigh.toFixed(2)}% vs high $${yearHigh.toFixed(2)}`,
        indicators,
      };
    }
  }

  // 0c. Gap-and-go: gapped up today and holding/rising above the open
  //    Continuation of pre-market strength.
  if (dailyBars.length >= 2) {
    const yesterdayClose = dailyBars[dailyBars.length - 2].c;
    const todayOpen = dailyBars[dailyBars.length - 1].o;
    const gapPct = ((todayOpen - yesterdayClose) / yesterdayClose) * 100;
    const runningFromOpen = ((currentPrice - todayOpen) / todayOpen) * 100;
    if (gapPct >= 1 && gapPct <= 10 && runningFromOpen >= 0 && volumeRatio >= 1) {
      return {
        symbol, action: 'BUY', confidence: 0.68,
        reason: `Gap-and-go: +${gapPct.toFixed(1)}% gap, holding ${runningFromOpen >= 0 ? '+' : ''}${runningFromOpen.toFixed(1)}% above open`,
        indicators,
      };
    }
  }

  // 1. Momentum breakout: above VWAP, strong RSI, positive momentum, elevated volume
  //    Catches stocks that are surging (e.g. NOVT +6.66%, NET) instead of just buying dips
  if (currentPrice > vwapVal && rsiVal >= 55 && rsiVal <= 75 && priceChange5min >= 0.5 && volumeRatio >= 1.3) {
    return {
      symbol, action: 'BUY', confidence: 0.70,
      reason: `Momentum breakout: +${priceChange5min.toFixed(1)}% surge, RSI ${rsiVal.toFixed(0)}, ${volumeRatio.toFixed(1)}x volume, above VWAP`,
      indicators,
    };
  }

  // Dip-buying strategies (Freefall reversal, VWAP pull, Bollinger bounce)
  // are DISABLED — they conflict with the 2% stop-loss. Buying weakness and
  // cutting at -2% is structurally loss-making. Momentum strategies win.

  // 3a. RSI bullish divergence: price makes lower low, RSI makes higher low
  //    Mean-reversion reversal signal (kept — profitable in testing).
  if (closes.length >= 30) {
    const lookback = 20;
    const recentCloses = closes.slice(-lookback);
    const firstLow = Math.min(...recentCloses.slice(0, 10));
    const secondLow = Math.min(...recentCloses.slice(10));
    const firstLowIdx = recentCloses.slice(0, 10).indexOf(firstLow);
    const secondLowIdx = 10 + recentCloses.slice(10).indexOf(secondLow);
    const rsiAtFirstLow = rsi(closes.slice(0, closes.length - lookback + firstLowIdx + 1), 14);
    const rsiAtSecondLow = rsi(closes.slice(0, closes.length - lookback + secondLowIdx + 1), 14);
    if (secondLow < firstLow && rsiAtSecondLow > rsiAtFirstLow && rsiVal < 50) {
      return {
        symbol, action: 'BUY', confidence: 0.62,
        reason: `RSI bullish divergence: lower low $${secondLow.toFixed(2)} but RSI ${rsiAtSecondLow.toFixed(0)} > ${rsiAtFirstLow.toFixed(0)}`,
        indicators,
      };
    }
  }

  // 4. SMA golden cross: SMA20 crossed above SMA50, price above VWAP
  if (sma50Val && sma20Val > sma50Val && currentPrice > vwapVal && rsiVal > 40 && rsiVal < 70) {
    return {
      symbol, action: 'BUY', confidence: 0.55,
      reason: `Golden cross: SMA20 $${sma20Val.toFixed(2)} > SMA50 $${sma50Val.toFixed(2)}, above VWAP`,
      indicators,
    };
  }

  // ── sell signals ─────────────────────────────────────────────────

  // Price breaking below VWAP on elevated volume after being above
  if (prevPrice > vwapVal && currentPrice < vwapVal && volumeRatio > 1.2) {
    return {
      symbol, action: 'SELL', confidence: 0.6,
      reason: `VWAP breakdown: crossed below VWAP on ${volumeRatio.toFixed(1)}x volume`,
      indicators,
    };
  }

  // RSI overbought reversal
  if (rsiVal > 75 && priceChange5min < 0) {
    return {
      symbol, action: 'SELL', confidence: 0.55,
      reason: `RSI overbought: RSI ${rsiVal.toFixed(0)}, ${priceChange5min.toFixed(1)}% pull`,
      indicators,
    };
  }

  return { symbol, action: 'HOLD', confidence: 0, reason: 'No clear signal', indicators };
}

export async function analyzeWatchlist(symbols: string[]): Promise<TechnicalSignal[]> {
  const results: TechnicalSignal[] = [];
  for (const sym of symbols) {
    try {
      const signal = await analyzeTechnical(sym);
      if (signal && signal.action !== 'HOLD') {
        results.push(signal);
        log.info(`Technical: ${signal.action} ${sym} (${signal.confidence}) — ${signal.reason}`);
      }
    } catch {
      // skip failures silently
    }
  }
  results.sort((a, b) => b.confidence - a.confidence);
  return results;
}
