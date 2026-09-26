import assert from 'node:assert/strict';
import { runBacktest, summarize, toIsoDay, type BacktestResult } from '../src/services/backtestService.js';

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

async function runLogicTest(): Promise<void> {
  console.log('Testing backtest logic...');

  // Mock Alpaca data
  const fiveMin = [
    ...Array.from({ length: 60 }, (_, i) => bar(i, 100 + i * 0.1)),
    ...Array.from({ length: 20 }, (_, i) => bar(60 + i, 105.9 + (i + 1) * 0.5)),
  ];
  const oneDay = Array.from({ length: 5 }, (_, i) => bar(i, 100 + i * 0.1));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('timeframe=5Min')) {
      return new Response(JSON.stringify({ bars: fiveMin, next_page_token: null }), { status: 200 });
    }
    return new Response(JSON.stringify({ bars: oneDay, next_page_token: null }), { status: 200 });
  }) as unknown as typeof fetch;

  try {
    // 1. Test 100% capital allocation on $100,000
    const [resFull] = await runBacktest(['AAPL'], '2026-01-05', '2026-01-06', {
      startingCash: 100_000,
      positionSizePct: 1.0,
    });
    assert.equal(resFull.initialCash, 100_000);
    assert.ok(resFull.trades.length > 0);
    assert.ok(resFull.trades[0].qty > 900, `Expected > 900 shares on 100% alloc, got ${resFull.trades[0].qty}`);
    console.log(`✓ 100% allocation bought ${resFull.trades[0].qty} shares at $${resFull.trades[0].entry.toFixed(2)}`);

    // 2. Test 10% capital allocation on $50,000
    const [resSmall] = await runBacktest(['AAPL'], '2026-01-05', '2026-01-06', {
      startingCash: 50_000,
      positionSizePct: 0.10,
    });
    assert.equal(resSmall.initialCash, 50_000);
    assert.ok(resSmall.trades.length > 0);
    assert.ok(resSmall.trades[0].qty < 100, `Expected < 100 shares on 10% alloc, got ${resSmall.trades[0].qty}`);
    console.log(`✓ 10% allocation bought ${resSmall.trades[0].qty} shares at $${resSmall.trades[0].entry.toFixed(2)}`);

    // 3. Test summary and buy & hold benchmark
    const summary = summarize([resFull], 100_000);
    assert.equal(summary.initialCapital, 100_000);
    assert.ok(summary.buyAndHoldFinalEquity > 0);
    assert.ok(typeof summary.buyAndHoldReturnPct === 'number');
    console.log(`✓ Summary: Bot Return = ${summary.returnPct.toFixed(2)}% | Buy & Hold = ${summary.buyAndHoldReturnPct.toFixed(2)}%`);

    console.log('All logic tests passed successfully!');
  } finally {
    globalThis.fetch = originalFetch;
    const { cacheService } = await import('../src/services/cacheService.js');
    await cacheService.close();
  }
}

runLogicTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Logic test failed:', err);
    process.exit(1);
  });
