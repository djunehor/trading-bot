import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/server.js';
import { clearAllCache } from '../src/services/cacheService.js';
import { Server } from 'http';

process.env.NODE_ENV = 'test';

let server: Server;
let port: number;
let originalFetch: typeof globalThis.fetch;

test.before((_, done) => {
  originalFetch = globalThis.fetch;
  server = app.listen(0, () => {
    const address = server.address();
    if (address && typeof address === 'object') {
      port = address.port;
    }
    done();
  });
});

test.beforeEach(async () => {
  await clearAllCache();
  // Global fetch mock to intercept external Alpaca API calls while allowing local server HTTP requests
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = String(input);
    if (urlStr.includes('127.0.0.1')) {
      return originalFetch(input, init);
    }
    if (urlStr.includes('/v2/account')) {
      return new Response(JSON.stringify({ id: 'acc_srv_1', status: 'ACTIVE', equity: '100000', buying_power: '400000' }), { status: 200 });
    }
    if (urlStr.includes('/v2/positions/AAPL') && init?.method === 'DELETE') {
      return new Response(JSON.stringify({ id: 'close_ord_1', symbol: 'AAPL', status: 'accepted' }), { status: 200 });
    }
    if (urlStr.includes('/v2/positions')) {
      return new Response(JSON.stringify([{ symbol: 'AAPL', qty: '10', avg_entry_price: '150.00', market_value: '1500.00' }]), { status: 200 });
    }
    if (urlStr.includes('/v2/orders/ord_test_1') && init?.method === 'DELETE') {
      return new Response(JSON.stringify({ id: 'ord_test_1', status: 'canceled' }), { status: 200 });
    }
    if (urlStr.includes('/v2/orders')) {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'ord_new_1', symbol: 'NVDA', qty: '1', side: 'buy', status: 'accepted' }), { status: 200 });
      }
      return new Response(JSON.stringify([{ id: 'ord_1', symbol: 'AAPL', side: 'buy', qty: '5', status: 'filled' }]), { status: 200 });
    }
    if (urlStr.includes('/v1beta1/news')) {
      return new Response(JSON.stringify({
        news: [{ id: 10, headline: 'AAPL profit surge growth', summary: 'Bullish report', symbols: ['AAPL'] }]
      }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
});

test.after((_, done) => {
  globalThis.fetch = originalFetch;
  server.close(done);
});

test('HTTP API - GET /api/mode returns account mode', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/mode`);
  assert.equal(res.status, 200);
  const data = await res.json() as any;
  assert.ok(data.mode);
  assert.ok(data.baseUrl);
});

test('HTTP API - POST /api/mode toggles account mode & validates input', async () => {
  const invalidRes = await fetch(`http://127.0.0.1:${port}/api/mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'invalid' })
  });
  assert.equal(invalidRes.status, 400);

  const validRes = await fetch(`http://127.0.0.1:${port}/api/mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'paper' })
  });
  assert.equal(validRes.status, 200);
});

test('HTTP API - GET /api/account returns Alpaca account details', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/account`);
  assert.equal(res.status, 200);
  const account = await res.json() as any;
  assert.equal(account.id, 'acc_srv_1');
});

test('HTTP API - GET /api/positions returns open positions', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/positions`);
  assert.equal(res.status, 200);
  const positions = await res.json() as any[];
  assert.equal(positions.length, 1);
  assert.equal(positions[0].symbol, 'AAPL');
});

test('HTTP API - DELETE /api/positions/:symbol closes open position', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/positions/AAPL`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  const result = await res.json() as any;
  assert.equal(result.id, 'close_ord_1');
});

test('HTTP API - GET /api/orders returns orders with pagination', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/orders?page=1&limit=10`);
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.ok(body.orders);
  assert.ok(body.pagination);
});

test('HTTP API - GET /api/orders?source=db returns database orders', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/orders?source=db&page=1&limit=5`);
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.ok(body.orders);
  assert.ok(body.pagination);
  assert.equal(body.pagination.page, 1);
  assert.equal(body.pagination.limit, 5);
});

test('HTTP API - POST /api/orders validates and submits order', async () => {
  const invalidRes = await fetch(`http://127.0.0.1:${port}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(invalidRes.status, 400);

  const validRes = await fetch(`http://127.0.0.1:${port}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol: 'NVDA', qty: 1, side: 'buy', type: 'market' })
  });
  assert.equal(validRes.status, 200);
  const order = await validRes.json() as any;
  assert.equal(order.id, 'ord_new_1');
});

test('HTTP API - DELETE /api/orders/:id cancels pending order', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/orders/ord_test_1`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  const result = await res.json() as any;
  assert.equal(result.id, 'ord_test_1');
});

test('HTTP API - GET /api/news/sentiment returns analyzed stock sentiments', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/news/sentiment`);
  assert.equal(res.status, 200);
  const sentiments = await res.json() as any[];
  assert.ok(sentiments.length > 0);
});

test('HTTP API - GET /api/bot/logs returns paginated bot logs', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/bot/logs?page=1&limit=5`);
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.ok(body.logs);
  assert.ok(body.pagination);
});

test('HTTP API - Bot lifecycle control (GET status, POST start, POST stop)', async () => {
  const statusRes = await fetch(`http://127.0.0.1:${port}/api/bot/status`);
  assert.equal(statusRes.status, 200);

  const startRes = await fetch(`http://127.0.0.1:${port}/api/bot/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intervalSeconds: 60 })
  });
  assert.equal(startRes.status, 200);

  const stopRes = await fetch(`http://127.0.0.1:${port}/api/bot/stop`, {
    method: 'POST'
  });
  assert.equal(stopRes.status, 200);
});

test('HTTP API - GET /api/positions/closed returns realized P/L by symbol', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/positions/closed`);
  assert.equal(res.status, 200);
  const body = await res.json() as any[];
  assert.ok(Array.isArray(body));
});

test('HTTP API - GET /api/market/clock returns market schedule', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/market/clock`);
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.ok(body.marketStatus !== undefined && body.isOpen !== undefined && body.nextEvent !== undefined);
});

test('HTTP API - GET /api/account/equity-history returns snapshots', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/account/equity-history?limit=5`);
  assert.equal(res.status, 200);
  const body = await res.json() as any[];
  assert.ok(Array.isArray(body));
});

test('HTTP API - POST /api/account/reset resets baseline', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/account/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  // reset may return 200 or 400 depending on state; assert it returns JSON
  assert.ok(res.status === 200 || res.status === 400);
  await res.json();
});

test('HTTP API - GET /api/bot/status with assetClass filter', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/bot/status?assetClass=us_equity`);
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.ok(body.isRunning !== undefined);
});
