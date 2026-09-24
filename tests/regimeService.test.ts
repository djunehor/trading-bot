import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

process.env.NODE_ENV = 'test';

import { MarketRegimeService } from '../src/services/regimeService.js';

const originalFetch = globalThis.fetch;

interface FakeResponse {
  status: number;
  body: unknown;
}

function bar(date: string, close: number): { t: string; c: number } {
  return { t: `${date}T04:00:00Z`, c: close };
}

/** 20 completed sessions at 500 followed by today's (incomplete) session. */
function twentySessionsPlusToday(todayClose = 1000): { bars: { t: string; c: number }[] } {
  const bars: { t: string; c: number }[] = [];
  // 2026-08-26 .. 2026-09-22 style; exact weekdays are irrelevant to the SMA.
  const completedDates = [
    '2026-08-26',
    '2026-08-27',
    '2026-08-28',
    '2026-08-31',
    '2026-09-01',
    '2026-09-02',
    '2026-09-03',
    '2026-09-04',
    '2026-09-07',
    '2026-09-08',
    '2026-09-09',
    '2026-09-10',
    '2026-09-11',
    '2026-09-14',
    '2026-09-15',
    '2026-09-16',
    '2026-09-17',
    '2026-09-18',
    '2026-09-21',
    '2026-09-22',
  ];
  for (const date of completedDates) {
    bars.push(bar(date, 500));
  }
  bars.push(bar('2026-09-24', todayClose)); // current session — must be excluded
  return { bars: bars.reverse() }; // Alpaca returns newest-first
}

function installFetch(handler: (url: string) => FakeResponse): { calls: string[] } {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const { status, body } = handler(url);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { calls };
}

const NOW = Date.parse('2026-09-24T15:00:00Z');

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('RegimeService - risk-on when price is above the 20-session SMA', async () => {
  const { calls } = installFetch((url) => {
    if (url.includes('/bars')) {
      return { status: 200, body: twentySessionsPlusToday() };
    }
    return { status: 200, body: { trade: { p: 600 } } };
  });

  const service = new MarketRegimeService(true);
  const regime = await service.computeRegime(NOW);

  assert.equal(regime.riskOn, true);
  assert.equal(regime.sma, 500);
  assert.equal(regime.price, 600);
  assert.equal(regime.source, 'live');

  // Regression guard: the bars query must request IEX explicitly and include a
  // start date, or the free plan returns a single bar and the SMA never forms.
  const barsCall = calls.find((url) => url.includes('/bars'));
  assert.ok(barsCall);
  assert.match(barsCall, /feed=iex/);
  assert.match(barsCall, /start=\d{4}-\d{2}-\d{2}/);
});

test('RegimeService - risk-off when price is below the SMA', async () => {
  installFetch((url) => {
    if (url.includes('/bars')) {
      return { status: 200, body: twentySessionsPlusToday() };
    }
    return { status: 200, body: { trade: { p: 400 } } };
  });

  const regime = await new MarketRegimeService(true).computeRegime(NOW);
  assert.equal(regime.riskOn, false);
  assert.equal(regime.source, 'live');
});

test('RegimeService - excludes the incomplete current-session bar from the SMA', async () => {
  // Today's close is wildly high (1000). If it leaked into the SMA the average
  // would be 525 and the regime would read differently.
  installFetch((url) => {
    if (url.includes('/bars')) {
      return { status: 200, body: twentySessionsPlusToday(1000) };
    }
    return { status: 200, body: { trade: { p: 600 } } };
  });

  const regime = await new MarketRegimeService(true).computeRegime(NOW);
  assert.equal(regime.sma, 500);
  assert.equal(regime.riskOn, true);
});

test('RegimeService - falls back to last completed close when live trade fetch fails', async () => {
  installFetch((url) => {
    if (url.includes('/bars')) {
      return { status: 200, body: twentySessionsPlusToday() };
    }
    return { status: 500, body: {} };
  });

  const regime = await new MarketRegimeService(true).computeRegime(NOW);
  assert.equal(regime.price, 500);
  assert.equal(regime.riskOn, false);
});

test('RegimeService - fails safe to risk-off when there are too few bars', async () => {
  installFetch(() => ({ status: 200, body: { bars: [bar('2026-09-24', 500), bar('2026-09-23', 500)] } }));

  const regime = await new MarketRegimeService(true).computeRegime(NOW);
  assert.equal(regime.riskOn, false);
  assert.equal(regime.source, 'error');
});

test('RegimeService - fails safe to risk-off on HTTP error', async () => {
  installFetch(() => ({ status: 503, body: {} }));

  const regime = await new MarketRegimeService(true).computeRegime(NOW);
  assert.equal(regime.riskOn, false);
  assert.equal(regime.source, 'error');
});

test('RegimeService - disabled sleeve is a strict no-op (gate open, no fetch)', async () => {
  const { calls } = installFetch(() => ({ status: 200, body: {} }));

  const regime = await new MarketRegimeService(false).getRegime(NOW);
  assert.equal(regime.riskOn, true);
  assert.equal(regime.source, 'disabled');
  assert.equal(calls.length, 0);
});

test('RegimeService - survives a thrown live-price fetch', async () => {
  globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/bars')) {
      return new Response(JSON.stringify(twentySessionsPlusToday()), { status: 200 });
    }
    throw new Error('network down');
  }) as unknown as typeof fetch;

  const regime = await new MarketRegimeService(true).computeRegime(NOW);
  assert.equal(regime.price, 500);
  assert.equal(regime.source, 'live');
});

test('RegimeService - empty bar payload fails safe', async () => {
  installFetch(() => ({ status: 200, body: { bars: [] } }));

  const regime = await new MarketRegimeService(true).computeRegime(NOW);
  assert.equal(regime.source, 'error');
});

test('RegimeService - caches the regime between checks', async () => {
  const { calls } = installFetch((url) => {
    if (url.includes('/bars')) {
      return { status: 200, body: twentySessionsPlusToday() };
    }
    return { status: 200, body: { trade: { p: 600 } } };
  });

  const service = new MarketRegimeService(true);
  await service.getRegime(NOW);
  const afterFirst = calls.length;
  const second = await service.getRegime(NOW + 60_000);

  assert.equal(calls.length, afterFirst); // served from cache
  assert.equal(second.riskOn, true);

  service.resetCache();
  await service.getRegime(NOW + 2 * 60_000);
  assert.ok(calls.length > afterFirst); // cache cleared -> refetched
});
