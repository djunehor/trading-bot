import assert from 'node:assert/strict';
import test, { after, afterEach } from 'node:test';

process.env.NODE_ENV = 'test';

import { runBacktest, summarize, toIsoDay, type BacktestResult } from '../src/services/backtestService.js';

const originalFetch = globalThis.fetch;

interface TestBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

function bar(index: number, close: number, volume = 1000): TestBar {
  const t = new Date(Date.parse('2026-01-05T14:30:00Z') + index * 300_000).toISOString();
  return { t, o: close - 0.05, h: close + 0.5, l: close - 0.5, c: close, v: volume };
}

function mockAlpaca(fiveMin: TestBar[], oneDay: TestBar[]): void {
  globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('timeframe=5Min')) {
      return new Response(JSON.stringify({ bars: fiveMin, next_page_token: null }), { status: 200 });
    }
    return new Response(JSON.stringify({ bars: oneDay, next_page_token: null }), { status: 200 });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('toIsoDay normalizes date-only strings and passes through datetimes', () => {
  assert.equal(toIsoDay('2026-08-19'), '2026-08-19T00:00:00Z');
  assert.equal(toIsoDay('2026-08-19T12:00:00Z'), '2026-08-19T12:00:00Z');
});

test('summarize aggregates trades across results', () => {
  const results: BacktestResult[] = [
    {
      symbol: 'AAPL',
      initialCash: 100_000,
      finalEquity: 100_000,
      maxDrawdown: 5,
      buyAndHoldReturnPct: 10,
      buyAndHoldFinalEquity: 110_000,
      startPrice: 100,
      endPrice: 110,
      trades: [
        { symbol: 'AAPL', entry: 10, exit: 11, qty: 1, pnl: 1, pnlPct: 10, reason: 'a', entryTime: '', exitTime: '' },
        { symbol: 'AAPL', entry: 10, exit: 9, qty: 1, pnl: -1, pnlPct: -10, reason: 'b', entryTime: '', exitTime: '' },
      ],
    },
    {
      symbol: 'MSFT',
      initialCash: 100_000,
      finalEquity: 100_000,
      maxDrawdown: 3,
      buyAndHoldReturnPct: 20,
      buyAndHoldFinalEquity: 120_000,
      startPrice: 200,
      endPrice: 240,
      trades: [{ symbol: 'MSFT', entry: 10, exit: 12, qty: 1, pnl: 2, pnlPct: 20, reason: 'c', entryTime: '', exitTime: '' }],
    },
  ];

  const summary = summarize(results, 200_000);
  assert.equal(summary.trades, 3);
  assert.equal(summary.wins, 2);
  assert.equal(summary.losses, 1);
  assert.equal(summary.totalPnl, 2);
  assert.equal(summary.initialCapital, 200_000);
  assert.equal(summary.finalEquity, 200_002);
  assert.equal(summary.returnPct, 0.001);
  assert.equal(summary.buyAndHoldReturnPct, 15);
  assert.equal(summary.buyAndHoldFinalEquity, 230_000);
  assert.equal(summary.maxDrawdown, 5);
  assert.ok(Math.abs(summary.winRate - 66.666) < 0.01);
  assert.equal(summary.avgWin, 1.5);
  assert.equal(summary.avgLoss, -1);
});

test('summarize handles an empty result set', () => {
  const summary = summarize([]);
  assert.equal(summary.trades, 0);
  assert.equal(summary.winRate, 0);
  assert.equal(summary.avgWin, 0);
  assert.equal(summary.initialCapital, 100_000);
  assert.equal(summary.finalEquity, 100_000);
  assert.equal(summary.returnPct, 0);
});

test('runBacktest respects custom initial capital and 100% position allocation', async () => {
  const fiveMin = [
    ...Array.from({ length: 60 }, (_, i) => bar(i, 100 + i * 0.1)),
    ...Array.from({ length: 20 }, (_, i) => bar(60 + i, 105.9 + (i + 1) * 0.5)),
  ];
  const oneDay = Array.from({ length: 5 }, (_, i) => bar(i, 100 + i * 0.1));
  mockAlpaca(fiveMin, oneDay);

  const [result] = await runBacktest(['AAPL'], '2026-01-05', '2026-01-06', {
    startingCash: 50_000,
    positionSizePct: 1.0,
  });

  assert.equal(result.initialCash, 50_000);
  assert.ok(result.trades.length >= 1);
  // With 100% allocation on $50k and price ~$106, qty should be ~470 shares (not small ~23 shares)
  assert.ok(result.trades[0].qty > 400);
  assert.ok(typeof result.buyAndHoldReturnPct === 'number');
  assert.ok(result.buyAndHoldFinalEquity > 0);
});

test('runBacktest buys on an uptrend and closes out', async () => {
  // 60 bars of steady climb (triggers the sustained-uptrend buy), then a run-up
  // that reaches take-profit.
  const fiveMin = [
    ...Array.from({ length: 60 }, (_, i) => bar(i, 100 + i * 0.1)),
    ...Array.from({ length: 20 }, (_, i) => bar(60 + i, 105.9 + (i + 1) * 0.5)),
  ];
  const oneDay = Array.from({ length: 5 }, (_, i) => bar(i, 100 + i * 0.1));
  mockAlpaca(fiveMin, oneDay);

  const results = await runBacktest(['AAPL'], '2026-01-05', '2026-01-06');
  assert.equal(results.length, 1);
  const [result] = results;
  assert.equal(result.symbol, 'AAPL');
  assert.ok(result.trades.length >= 1);
  assert.ok(result.trades[0].exit > result.trades[0].entry);
  assert.ok(result.finalEquity > 0);
  assert.ok(result.maxDrawdown >= 0);
});

test('runBacktest handles a falling series (stop-loss / end-of-test exit)', async () => {
  const fiveMin = [
    ...Array.from({ length: 60 }, (_, i) => bar(i, 100 + i * 0.1)),
    ...Array.from({ length: 10 }, (_, i) => bar(60 + i, 105.9 - (i + 1) * 0.6)),
  ];
  const oneDay = Array.from({ length: 5 }, (_, i) => bar(i, 100 + i * 0.1));
  mockAlpaca(fiveMin, oneDay);

  const [result] = await runBacktest(['AAPL'], '2026-01-05', '2026-01-06');
  assert.ok(result.trades.length >= 1);
  // The position must have been closed by a risk rule or at the end of the test.
  assert.ok(result.trades.some((trade) => trade.exitTime.length > 0));
});

test('runBacktest returns an empty trade list for a too-short series', async () => {
  mockAlpaca([bar(0, 100), bar(1, 100.1)], [bar(0, 100), bar(1, 100.1)]);
  const [result] = await runBacktest(['AAPL'], '2026-01-05', '2026-01-06');
  assert.equal(result.trades.length, 0);
  assert.equal(result.finalEquity, 100_000);
});

after(async () => {
  const { cacheService } = await import('../src/services/cacheService.js');
  await cacheService.close();
});
