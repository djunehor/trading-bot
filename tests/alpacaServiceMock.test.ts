import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

import { getAccount, getPositions, getOrders, createOrder, cancelOrder, closePosition, getLatestBar } from '../src/services/alpacaService.js';
import { clearAllCache } from '../src/services/cacheService.js';

let originalFetch: typeof globalThis.fetch;

test.before((_) => {
  originalFetch = globalThis.fetch;
});

test.beforeEach(async () => {
  await clearAllCache();
});

test.after((_) => {
  globalThis.fetch = originalFetch;
});

test('Alpaca API Mock - getAccount success', async () => {
  const mockAccount = { id: 'acc_12345', status: 'ACTIVE', equity: '100000.00', buying_power: '400000.00' };

  globalThis.fetch = async (input: RequestInfo | URL) => {
    return new Response(JSON.stringify(mockAccount), { status: 200 });
  };

  const account = await getAccount();
  assert.equal(account.id, 'acc_12345');
  assert.equal(account.status, 'ACTIVE');
});

test('Alpaca API Mock - getAccount error handling', async () => {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    return new Response(JSON.stringify({ message: 'Invalid API key credentials' }), { status: 401, statusText: 'Bad Request' });
  };

  await assert.rejects(
    async () => {
      await getAccount();
    },
    (err: any) => {
      return err instanceof Error && err.message.includes('Invalid API key credentials');
    }
  );
});

test('Alpaca API Mock - getPositions & closePosition', async () => {
  const mockPosition = [{ symbol: 'AAPL', qty: '10', avg_entry_price: '150.00', market_value: '1500.00' }];

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = String(input);
    if (init && init.method === 'DELETE') {
      return new Response(JSON.stringify({ id: 'ord_close_1', status: 'accepted' }), { status: 200 });
    }
    return new Response(JSON.stringify(mockPosition), { status: 200 });
  };

  const positions = await getPositions();
  assert.equal(positions.length, 1);
  assert.equal(positions[0].symbol, 'AAPL');

  const closeResult = await closePosition('AAPL');
  assert.ok(closeResult);
});

test('Alpaca API Mock - getOrders, createOrder & cancelOrder', async () => {
  const mockOrder = { id: 'ord_1', symbol: 'TSLA', side: 'buy', qty: '2', status: 'new' };

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = String(input);
    if (init && init.method === 'POST') {
      return new Response(JSON.stringify({ id: 'ord_2', symbol: 'NVDA', side: 'buy', qty: '1', status: 'accepted' }), { status: 200 });
    }
    if (init && init.method === 'DELETE') {
      return new Response(JSON.stringify({ id: 'ord_2', status: 'canceled' }), { status: 200 });
    }
    return new Response(JSON.stringify([mockOrder]), { status: 200 });
  };

  const orders = await getOrders();
  assert.equal(orders.length, 1);

  const created = await createOrder({ symbol: 'NVDA', qty: 1, side: 'buy', type: 'limit', limit_price: 200 });
  assert.equal(created.id, 'ord_2');

  const canceled = await cancelOrder('ord_2');
  assert.ok(canceled);
});

test('Alpaca API Mock - getLatestBar', async () => {
  const mockBarResponse = { bar: { c: 153.50, t: new Date().toISOString() } };

  globalThis.fetch = async (input: RequestInfo | URL) => {
    return new Response(JSON.stringify(mockBarResponse), { status: 200 });
  };

  const bar = await getLatestBar('AAPL');
  assert.ok(bar);
  assert.equal(bar.c, 153.50);
});
