import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import test, { after } from 'node:test';

import { app } from '../src/server.js';
import { cacheService } from '../src/services/cacheService.js';

process.env.NODE_ENV = 'test';
delete process.env.AUTH_USERNAME;
delete process.env.AUTH_PASSWORD;

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
  await cacheService.clearAll();
  // Global fetch mock to intercept external Alpaca API calls while allowing local server HTTP requests
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlString = String(input);
    if (urlString.includes('127.0.0.1')) {
      return originalFetch(input, init);
    }
    if (urlString.includes('/v2/account/portfolio/history')) {
      return new Response(
        JSON.stringify({ base_value: 100000, equity: [100000], profit_loss: [0], profit_loss_pct: [0], timeframe: '1D' }),
        { status: 200 },
      );
    }
    if (urlString.includes('/v2/account')) {
      return new Response(JSON.stringify({ id: 'acc_srv_1', status: 'ACTIVE', equity: '100000', buying_power: '400000' }), { status: 200 });
    }
    if (urlString.includes('/v2/positions/AAPL') && init?.method === 'DELETE') {
      return new Response(JSON.stringify({ id: 'close_ord_1', symbol: 'AAPL', status: 'accepted' }), { status: 200 });
    }
    if (urlString.includes('/v2/positions')) {
      return new Response(JSON.stringify([{ symbol: 'AAPL', qty: '10', avg_entry_price: '150.00', market_value: '1500.00' }]), {
        status: 200,
      });
    }
    if (urlString.includes('/v2/orders/ord_test_1') && init?.method === 'DELETE') {
      return new Response(JSON.stringify({ id: 'ord_test_1', status: 'canceled' }), { status: 200 });
    }
    if (urlString.includes('/v2/orders')) {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'ord_new_1', symbol: 'NVDA', qty: '1', side: 'buy', status: 'accepted' }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify([{ id: 'ord_1', symbol: 'AAPL', side: 'buy', qty: '5', status: 'filled' }]), { status: 200 });
    }
    if (urlString.includes('/v1beta1/news')) {
      return new Response(
        JSON.stringify({
          news: [{ id: 10, headline: 'AAPL profit surge growth', summary: 'Bullish report', symbols: ['AAPL'] }],
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
});

test.after((_, done) => {
  globalThis.fetch = originalFetch;
  server.close(done);
});

test('HTTP API - GET /api/mode returns account mode', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/mode`);
  assert.equal(response.status, 200);
  const data = (await response.json()) as any;
  assert.ok(data.mode);
  assert.ok(data.baseUrl);
});

test('HTTP API - POST /api/mode toggles account mode & validates input', async () => {
  const invalidResponse = await fetch(`http://127.0.0.1:${port}/api/mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'invalid' }),
  });
  assert.equal(invalidResponse.status, 400);

  const validResponse = await fetch(`http://127.0.0.1:${port}/api/mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'paper' }),
  });
  assert.equal(validResponse.status, 200);
});

test('HTTP API - GET /api/account returns Alpaca account details', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/account`);
  assert.equal(response.status, 200);
  const account = (await response.json()) as any;
  assert.equal(account.id, 'acc_srv_1');
});

test('HTTP API - GET /api/positions returns open positions', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/positions`);
  assert.equal(response.status, 200);
  const positions = (await response.json()) as any[];
  assert.equal(positions.length, 1);
  assert.equal(positions[0].symbol, 'AAPL');
});

test('HTTP API - DELETE /api/positions/:symbol closes open position', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/positions/AAPL`, { method: 'DELETE' });
  assert.equal(response.status, 200);
  const result = (await response.json()) as any;
  assert.equal(result.id, 'close_ord_1');
});

test('HTTP API - GET /api/orders returns orders with pagination', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/orders?page=1&limit=10`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as any;
  assert.ok(body.orders);
  assert.ok(body.pagination);
});

test('HTTP API - GET /api/orders?source=db returns database orders', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/orders?source=db&page=1&limit=5`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as any;
  assert.ok(body.orders);
  assert.ok(body.pagination);
  assert.equal(body.pagination.page, 1);
  assert.equal(body.pagination.limit, 5);
});

test('HTTP API - POST /api/orders validates and submits order', async () => {
  const invalidResponse = await fetch(`http://127.0.0.1:${port}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(invalidResponse.status, 400);

  const validResponse = await fetch(`http://127.0.0.1:${port}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol: 'NVDA', qty: 1, side: 'buy', type: 'market' }),
  });
  assert.equal(validResponse.status, 200);
  const order = (await validResponse.json()) as any;
  assert.equal(order.id, 'ord_new_1');
});

test('HTTP API - DELETE /api/orders/:id cancels pending order', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/orders/ord_test_1`, { method: 'DELETE' });
  assert.equal(response.status, 200);
  const result = (await response.json()) as any;
  assert.equal(result.id, 'ord_test_1');
});

test('HTTP API - GET /api/news/sentiment returns analyzed stock sentiments', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/news/sentiment`);
  assert.equal(response.status, 200);
  const sentiments = (await response.json()) as any[];
  assert.ok(sentiments.length > 0);
});

test('HTTP API - GET /api/bot/logs returns paginated bot logs', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/bot/logs?page=1&limit=5`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as any;
  assert.ok(body.logs);
  assert.ok(body.pagination);
});

test('HTTP API - Bot lifecycle control (GET status, POST start, POST stop)', async () => {
  const statusResponse = await fetch(`http://127.0.0.1:${port}/api/bot/status`);
  assert.equal(statusResponse.status, 200);

  const startResponse = await fetch(`http://127.0.0.1:${port}/api/bot/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intervalSeconds: 60 }),
  });
  assert.equal(startResponse.status, 200);

  const stopResponse = await fetch(`http://127.0.0.1:${port}/api/bot/stop`, {
    method: 'POST',
  });
  assert.equal(stopResponse.status, 200);
});

test('HTTP API - GET /api/positions/closed returns realized P/L by symbol', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/positions/closed`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as any[];
  assert.ok(Array.isArray(body));
});

test('HTTP API - GET /api/market/clock returns market schedule', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/market/clock`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as any;
  assert.ok(body.marketStatus !== undefined && body.isOpen !== undefined && body.nextEvent !== undefined);
});

test('HTTP API - GET /api/account/equity-history returns snapshots', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/account/equity-history?limit=5`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as any[];
  assert.ok(Array.isArray(body));
});

test('HTTP API - POST /api/account/reset resets baseline', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/account/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  // reset may return 200 or 400 depending on state; assert it returns JSON
  assert.ok(response.status === 200 || response.status === 400);
  await response.json();
});

test('HTTP API - GET /api/bot/status with assetClass filter', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/bot/status?assetClass=us_equity`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as any;
  assert.ok(body.isRunning !== undefined);
});

test('HTTP API - Basic auth rejects when credentials set', async () => {
  process.env.AUTH_USERNAME = 'admin';
  process.env.AUTH_PASSWORD = 'secret';
  try {
    const noAuth = await fetch(`http://127.0.0.1:${port}/api/mode`);
    assert.equal(noAuth.status, 401);

    const badAuth = await fetch(`http://127.0.0.1:${port}/api/mode`, {
      headers: { Authorization: `Basic ${Buffer.from('admin:wrong').toString('base64')}` },
    });
    assert.equal(badAuth.status, 401);

    const goodAuth = await fetch(`http://127.0.0.1:${port}/api/mode`, {
      headers: { Authorization: `Basic ${Buffer.from('admin:secret').toString('base64')}` },
    });
    assert.equal(goodAuth.status, 200);
  } finally {
    delete process.env.AUTH_USERNAME;
    delete process.env.AUTH_PASSWORD;
  }
});

after(async () => {
  const { cacheService } = await import('../src/services/cacheService.js');
  await cacheService.close();
});
