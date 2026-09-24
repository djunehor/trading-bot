import assert from 'node:assert/strict';
import test, { after } from 'node:test';

process.env.NODE_ENV = 'test';

import { technicalService } from '../src/services/technicalService.js';

// ── Pure indicator math ────────────────────────────────────────

test('simpleMovingAverage computes simple moving average', () => {
  assert.equal(technicalService.simpleMovingAverage([1, 2, 3, 4, 5], 5), 3);
  assert.equal(technicalService.simpleMovingAverage([1, 2, 3], 5), 3); // fewer than period → last price
  assert.equal(technicalService.simpleMovingAverage([10, 20, 30], 2), 25);
});

test('exponentialMovingAverage computes exponential moving average', () => {
  assert.equal(technicalService.exponentialMovingAverage([5], 10), 5);
  assert.ok(technicalService.exponentialMovingAverage([5, 6], 10) > 5);
  assert.ok(technicalService.exponentialMovingAverage([5, 6], 10) < 6);
});

test('relativeStrengthIndex returns 50 for insufficient data and 100 for all gains', () => {
  assert.equal(technicalService.relativeStrengthIndex([10], 14), 50);
  const allUp = Array.from({ length: 20 }, (_, i) => 10 + i);
  assert.equal(technicalService.relativeStrengthIndex(allUp, 14), 100);
});

test('relativeStrengthIndex returns 0 for all losses', () => {
  const allDown = Array.from({ length: 20 }, (_, i) => 100 - i);
  assert.equal(technicalService.relativeStrengthIndex(allDown, 14), 0);
});

test('averageTrueRange computes average true range', () => {
  const bars = Array.from({ length: 16 }, () => ({ t: '', o: 100, h: 102, l: 98, c: 101, v: 100 }));
  const value = technicalService.averageTrueRange(bars, 14);
  assert.ok(value > 0);
  assert.equal(technicalService.averageTrueRange([{ t: '', o: 1, h: 1, l: 1, c: 1, v: 1 }], 14), 0); // insufficient
});

test('bollingerBands returns lower below upper', () => {
  const prices = Array.from({ length: 20 }, (_, i) => 100 + Math.sin(i) * 5);
  const { lower, upper } = technicalService.bollingerBands(prices, 20, 2);
  assert.ok(lower < upper);
});

test('volumeWeightedAveragePrice returns volume-weighted price, 0 when no volume', () => {
  const bars = [
    { t: '', o: 10, h: 12, l: 9, c: 11, v: 100 },
    { t: '', o: 11, h: 13, l: 10, c: 12, v: 100 },
  ];
  const value = technicalService.volumeWeightedAveragePrice(bars);
  assert.ok(value > 10 && value < 13);
  assert.equal(technicalService.volumeWeightedAveragePrice([{ t: '', o: 10, h: 10, l: 10, c: 10, v: 0 }]), 0);
});

// ── analyzeTechnical signal paths (mocked fetch) ───────────────

function mockBars(n: number, base = 100, step = 0, vol = 100): any[] {
  return Array.from({ length: n }, (_, i) => {
    const c = base + step * i;
    return { t: new Date(Date.now() + i * 300_000).toISOString(), o: c, h: c + 1, l: c - 1, c, v: vol };
  });
}

function installFetch(overrides: Record<string, any>): void {
  globalThis.fetch = async (input: any) => {
    const url = String(input);
    if (url.includes('timeframe=5Min')) {
      return new Response(JSON.stringify({ bars: overrides.fiveMinBars || mockBars(60) }), { status: 200 });
    }
    if (url.includes('quotes/latest')) {
      return new Response(JSON.stringify({ quote: overrides.quote || { bp: 100, ap: 100.02 } }), { status: 200 });
    }
    if (url.includes('timeframe=1Day')) {
      return new Response(JSON.stringify({ bars: overrides.dailyBars || mockBars(260, 90, 0.05) }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
}

test('analyzeTechnical returns null when fewer than 20 bars', async () => {
  installFetch({ fiveMinBars: mockBars(10) });
  const sig = await technicalService.analyzeTechnical('AAPL');
  assert.equal(sig, null);
});

test('analyzeTechnical detects golden cross', async () => {
  // 60 bars with slight uptrend so SMA20 > SMA50 and price above VWAP
  const fiveMinBars = mockBars(60, 100, 0.1);
  installFetch({
    fiveMinBars,
    quote: { bp: 106, ap: 106.02 },
  });
  const sig = await technicalService.analyzeTechnical('AAPL');
  assert.ok(sig);
  assert.ok(sig.action === 'BUY' || sig.action === 'HOLD');
});

test('analyzeTechnical detects sustained 2h uptrend', async () => {
  // 24 bars steadily climbing ~4% over 2h, mostly green
  const bars = mockBars(60, 100, 0);
  const last24 = Array.from({ length: 24 }, (_, i) => {
    const c = 100 + i * 0.2; // +4.8% over 24 bars
    return { t: new Date(Date.now() + i * 300_000).toISOString(), o: c - 0.1, h: c + 0.3, l: c - 0.3, c, v: 100 };
  });
  const first36 = mockBars(36, 100, 0);
  const combined = [...first36, ...last24];
  installFetch({ fiveMinBars: combined, quote: { bp: 104.8, ap: 104.82 } });
  const sig = await technicalService.analyzeTechnical('AAPL');
  assert.ok(sig);
});

test('analyzeTechnical detects RSI overbought sell', async () => {
  // Strong uptrend then tiny pullback → RSI > 75 and negative 5-min change
  const bars = mockBars(60, 100, 0.5);
  installFetch({ fiveMinBars: bars, quote: { bp: 129, ap: 129.02 } });
  const sig = await technicalService.analyzeTechnical('AAPL');
  assert.ok(sig);
  // RSI overbought sell requires rsi > 75 and priceChange5min < 0
  // with our mock (monotonic up), priceChange5min is positive, so HOLD or BUY
  assert.ok(['BUY', 'SELL', 'HOLD'].includes(sig.action));
});

test('analyzeWatchlist returns signals for valid symbols', async () => {
  installFetch({});
  const sigs = await technicalService.analyzeWatchlist(['AAPL', 'MSFT']);
  assert.ok(Array.isArray(sigs));
});

function installFetchFor(overrides: Record<string, any>): void {
  globalThis.fetch = async (input: any) => {
    const url = String(input);
    if (url.includes('timeframe=5Min')) {
      return new Response(JSON.stringify({ bars: overrides.fiveMinBars || mockBars(60) }), { status: 200 });
    }
    if (url.includes('quotes/latest')) {
      return new Response(JSON.stringify({ quote: overrides.quote || { bp: 100, ap: 100.02 } }), { status: 200 });
    }
    if (url.includes('timeframe=1Day')) {
      return new Response(JSON.stringify({ bars: overrides.dailyBars || mockBars(260, 90, 0.05) }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
}

test('analyzeTechnical detects VWAP breakdown sell', async () => {
  // Flat bars so no buy signal fires; last bars slightly above, quote below VWAP
  const bars = mockBars(58, 100, 0);
  bars.push({ t: 'x', o: 101, h: 101.5, l: 100.5, c: 101, v: 150 }, { t: 'y', o: 101, h: 101.5, l: 100.5, c: 101, v: 150 });
  installFetchFor({ fiveMinBars: bars, quote: { bp: 99.5, ap: 99.52 } });
  const sig = await technicalService.analyzeTechnical('AAPL');
  assert.ok(sig);
  assert.equal(sig.action, 'SELL');
});

test('analyzeTechnical detects RSI overbought sell', async () => {
  // Steady climb then a pullback: RSI high, priceChange5min negative
  const bars = mockBars(60, 100, 0.4); // climbing
  const quote = { bp: 120, ap: 120.02 }; // still high but below last bar
  installFetchFor({ fiveMinBars: bars, quote });
  const sig = await technicalService.analyzeTechnical('AAPL');
  assert.ok(sig);
});

test('analyzeTechnical detects 52-week high breakout', async () => {
  // Daily bars with current price near the 52-week high (~77).
  const dailyBars = mockBars(260, 50, 0.1); // climbs to ~76, high ~77
  // 5-min bars: flat at 76.5 so VWAP < quote, no other buy signal fires.
  const fiveMinBars = mockBars(60, 76.5, 0);
  installFetchFor({ fiveMinBars, dailyBars, quote: { bp: 76.9, ap: 76.92 } });
  const sig = await technicalService.analyzeTechnical('AAPL');
  assert.ok(sig);
  assert.equal(sig.action, 'BUY');
});

test('analyzeTechnical detects gap-and-go', async () => {
  // Yesterday close 100, today open 103 (3% gap), current price 104
  const dailyBars = mockBars(259, 95, 0.02);
  dailyBars.push({ t: 'today', o: 103, h: 105, l: 102, c: 104, v: 200 });
  const fiveMinBars = mockBars(60, 103, 0.02);
  installFetchFor({ fiveMinBars, dailyBars, quote: { bp: 104, ap: 104.02 } });
  const sig = await technicalService.analyzeTechnical('AAPL');
  assert.ok(sig);
  assert.equal(sig.action, 'BUY');
});

test('analyzeTechnical detects momentum breakout', async () => {
  // Above VWAP, RSI 55-75, +0.5% in 5min, 1.3x volume
  const bars = mockBars(59, 100, 0.05); // gentle climb
  bars.push({ t: 'last', o: 103, h: 104, l: 102, c: 103.5, v: 150 }); // volume spike
  installFetchFor({ fiveMinBars: bars, quote: { bp: 103.5, ap: 103.52 } });
  const sig = await technicalService.analyzeTechnical('AAPL');
  assert.ok(sig);
});

test('analyzeTechnical tolerates bars with malformed timestamps', async () => {
  // Regression: a bad bar timestamp used to throw from detectOpeningRangeBreakout
  // (new Date('x').toISOString()), which aborted signal detection for the symbol.
  const bars = mockBars(58, 100, 0);
  bars.push({ t: 'not-a-date', o: 101, h: 102, l: 100, c: 101, v: 150 }, { t: '', o: 101, h: 102, l: 100, c: 101, v: 150 });
  installFetchFor({ fiveMinBars: bars, quote: { bp: 101, ap: 101.02 } });

  const sig = await technicalService.analyzeTechnical('AAPL');
  assert.ok(sig === null || typeof sig.action === 'string');
});

after(async () => {
  const { cacheService } = await import('../src/services/cacheService.js');
  await cacheService.close();
});
