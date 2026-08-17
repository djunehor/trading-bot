import assert from 'node:assert/strict';
import test, { after } from 'node:test';

process.env.NODE_ENV = 'test';

import { alpacaService } from '../src/services/alpacaService.js';
import { cacheService } from '../src/services/cacheService.js';
import { portfolioService } from '../src/services/portfolioService.js';

let originalFetch: typeof globalThis.fetch;

test.before((_) => {
  originalFetch = globalThis.fetch;
});

test.beforeEach(async () => {
  await cacheService.clearAll();
});

test.after((_) => {
  globalThis.fetch = originalFetch;
});

test('Alpaca API Mock - getAccount success', async () => {
  const mockAccount = { id: 'acc_12345', status: 'ACTIVE', equity: '100000.00', buying_power: '400000.00' };

  globalThis.fetch = async (input: RequestInfo | URL) => {
    return new Response(JSON.stringify(mockAccount), { status: 200 });
  };

  const account = await alpacaService.getAccount();
  assert.equal(account.id, 'acc_12345');
  assert.equal(account.status, 'ACTIVE');
});

test('Alpaca API Mock - getAccount error handling', async () => {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    return new Response(JSON.stringify({ message: 'Invalid API key credentials' }), { status: 401, statusText: 'Bad Request' });
  };

  await assert.rejects(
    async () => {
      await alpacaService.getAccount();
    },
    (error: any) => {
      return error instanceof Error && error.message.includes('Invalid API key credentials');
    },
  );
});

test('Alpaca API Mock - getPositions & closePosition', async () => {
  const mockPosition = [{ symbol: 'AAPL', qty: '10', avg_entry_price: '150.00', market_value: '1500.00' }];

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlString = String(input);
    if (init && init.method === 'DELETE') {
      return new Response(JSON.stringify({ id: 'ord_close_1', status: 'accepted' }), { status: 200 });
    }
    return new Response(JSON.stringify(mockPosition), { status: 200 });
  };

  const positions = await alpacaService.getPositions();
  assert.equal(positions.length, 1);
  assert.equal(positions[0].symbol, 'AAPL');

  const closeResult = await alpacaService.closePosition('AAPL');
  assert.ok(closeResult);
});

test('Alpaca API Mock - getOrders, createOrder & cancelOrder', async () => {
  const mockOrder = { id: 'ord_1', symbol: 'TSLA', side: 'buy', qty: '2', status: 'new' };

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlString = String(input);
    if (init && init.method === 'POST') {
      return new Response(JSON.stringify({ id: 'ord_2', symbol: 'NVDA', side: 'buy', qty: '1', status: 'accepted' }), { status: 200 });
    }
    if (init && init.method === 'DELETE') {
      return new Response(JSON.stringify({ id: 'ord_2', status: 'canceled' }), { status: 200 });
    }
    return new Response(JSON.stringify([mockOrder]), { status: 200 });
  };

  const orders = await alpacaService.getOrders();
  assert.equal(orders.length, 1);

  const created = await alpacaService.createOrder({ symbol: 'NVDA', qty: 1, side: 'buy', type: 'limit', limit_price: 200 });
  assert.equal(created.id, 'ord_2');

  const canceled = await alpacaService.cancelOrder('ord_2');
  assert.ok(canceled);
});

test('Alpaca API Mock - getLatestBar', async () => {
  const mockBarResponse = { bar: { c: 153.5, t: new Date().toISOString() } };

  globalThis.fetch = async (input: RequestInfo | URL) => {
    return new Response(JSON.stringify(mockBarResponse), { status: 200 });
  };

  const bar = await alpacaService.getLatestBar('AAPL');
  assert.ok(bar);
  assert.equal(bar.c, 153.5);
});

// ── New functions ─────────────────────────────────────────────

test('Alpaca API Mock - getCurrentPrice stock quote midpoint', async () => {
  globalThis.fetch = async (input: any) => {
    const url = String(input);
    if (url.includes('/quotes/latest')) {
      return new Response(JSON.stringify({ quote: { bp: 100, ap: 100.02 } }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
  const price = await alpacaService.getCurrentPrice('AAPL');
  assert.ok(Math.abs(price! - 100.01) < 0.001);
});

test('Alpaca API Mock - getCurrentPrice crypto trade', async () => {
  globalThis.fetch = async (input: any) => {
    const url = String(input);
    if (url.includes('/latest/trades')) {
      return new Response(JSON.stringify({ trades: { 'BTC/USD': { p: 65_000.5 } } }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
  const price = await alpacaService.getCurrentPrice('BTC/USD');
  assert.equal(price, 65_000.5);
});

test('Alpaca API Mock - getRealizedPlBySymbol FIFO matching', async () => {
  globalThis.fetch = async (input: any) => {
    const url = String(input);
    if (url.includes('/v2/orders')) {
      const orders = [
        {
          id: 'o1',
          symbol: 'AAPL',
          side: 'buy',
          qty: '10',
          filled_qty: '10',
          filled_avg_price: '100',
          status: 'filled',
          filled_at: new Date().toISOString(),
        },
        {
          id: 'o2',
          symbol: 'AAPL',
          side: 'sell',
          qty: '10',
          filled_qty: '10',
          filled_avg_price: '110',
          status: 'filled',
          filled_at: new Date().toISOString(),
        },
      ];
      return new Response(JSON.stringify(orders), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
  const result = await portfolioService.getRealizedPlBySymbol();
  assert.equal(result.length, 1);
  assert.equal(result[0].symbol, 'AAPL');
  assert.equal(result[0].realizedPl, 100); // 10 * (110 - 100)
  assert.equal(result[0].closedQty, 10);
});

test('Alpaca API Mock - getTodayRealizedPl sums today-only fills', async () => {
  const today = new Date().toISOString();
  globalThis.fetch = async (input: any) => {
    const url = String(input);
    if (url.includes('/v2/orders')) {
      const orders = [
        { id: 'o1', symbol: 'NVDA', side: 'buy', qty: '5', filled_qty: '5', filled_avg_price: '50', status: 'filled', filled_at: today },
        { id: 'o2', symbol: 'NVDA', side: 'sell', qty: '5', filled_qty: '5', filled_avg_price: '60', status: 'filled', filled_at: today },
      ];
      return new Response(JSON.stringify(orders), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
  const pl = await portfolioService.getTodayRealizedPl();
  assert.equal(pl, 50); // 5 * (60 - 50)
});

test('Alpaca API Mock - getTopMovers uses screener with price filter', async () => {
  globalThis.fetch = async (input: any) => {
    const url = String(input);
    if (url.includes('/screener/stocks/movers')) {
      return new Response(
        JSON.stringify({
          gainers: [
            { symbol: 'GOOD', price: 25 },
            { symbol: 'CHEAP', price: 3 },
            { symbol: 'WARRANT', price: 8 },
          ],
          losers: [{ symbol: 'BAD', price: 30 }],
          most_actives: [],
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
  await cacheService.clearAll();
  const movers = await alpacaService.getTopMovers();
  assert.ok(movers.includes('GOOD'));
  assert.ok(movers.includes('BAD'));
  assert.ok(!movers.includes('CHEAP')); // below $20 floor
  assert.ok(!movers.includes('WARRANT')); // ends in W
});

test('Alpaca API Mock - calculateRealizedPlFromOrders total FIFO', async () => {
  globalThis.fetch = async (input: any) => {
    const url = String(input);
    if (url.includes('/v2/orders')) {
      const orders = [
        {
          id: 'o1',
          symbol: 'AAPL',
          side: 'buy',
          qty: '10',
          filled_qty: '10',
          filled_avg_price: '100',
          status: 'filled',
          filled_at: new Date().toISOString(),
        },
        {
          id: 'o2',
          symbol: 'AAPL',
          side: 'sell',
          qty: '6',
          filled_qty: '6',
          filled_avg_price: '105',
          status: 'filled',
          filled_at: new Date().toISOString(),
        },
        {
          id: 'o3',
          symbol: 'AAPL',
          side: 'sell',
          qty: '4',
          filled_qty: '4',
          filled_avg_price: '95',
          status: 'filled',
          filled_at: new Date().toISOString(),
        },
      ];
      return new Response(JSON.stringify(orders), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
  const pl = await portfolioService.getRealizedPlFromApi('us_equity');
  assert.equal(pl, 10); // 6*(105-100) + 4*(95-100) = 30 - 20 = 10
});

after(async () => {
  const { cacheService } = await import('../src/services/cacheService.js');
  await cacheService.close();
});
