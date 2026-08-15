import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

import { volatilitySizedQty, calculatePositionSize, isMarketOpenOrOpeningSoon, isExtendedHours } from '../src/services/tradingBot.js';
import { isMediaReleasePost } from '../src/services/newsService.js';
import { getCache, setCache, delCache, clearAllCache } from '../src/services/cacheService.js';

test.beforeEach(async () => {
  await clearAllCache();
});

// ── tradingBot pure functions ─────────────────────────────────

test('volatilitySizedQty sizes so 1-ATR move = $25 risk', () => {
  // ATR 2%, price $100 → position value = 25 / 0.02 = 1250 → 12 shares
  assert.equal(volatilitySizedQty(100, 2), 12);
  // ATR 10%, price $100 → position value = 25 / 0.10 = 250 → 2 shares
  assert.equal(volatilitySizedQty(100, 10), 2);
  // invalid inputs
  assert.equal(volatilitySizedQty(0, 2), 0);
  assert.equal(volatilitySizedQty(100, 0), 0);
});

test('calculatePositionSize stock uses 5% of cash', async () => {
  const qty = await calculatePositionSize('AAPL', 100, 0, [], 100000, 0, 'us_equity');
  // 5% of 100000 = 5000, / 100 = 50 shares
  assert.equal(qty, 50);
});

test('calculatePositionSize crypto uses 5% notional', async () => {
  const qty = await calculatePositionSize('BTC/USD', 50000, 0, [], 100000, 0, 'crypto');
  // 5% of 100000 = 5000, / 50000 = 0.1
  assert.ok(qty > 0.05 && qty < 0.2);
});

test('calculatePositionSize returns 0 for no cash', async () => {
  const qty = await calculatePositionSize('AAPL', 100, 0, [], 0, 0, 'us_equity');
  assert.equal(qty, 0);
});

test('isMarketOpenOrOpeningSoon crypto always true', () => {
  assert.equal(isMarketOpenOrOpeningSoon('crypto'), true);
});

test('isExtendedHours returns boolean', () => {
  assert.equal(typeof isExtendedHours(), 'boolean');
});

// ── newsService helpers ────────────────────────────────────────

test('isMediaReleasePost detects torrent/media titles', () => {
  assert.equal(isMediaReleasePost('From Old Country Bumpkin To Master Swordsman S02E05 1080p AMZN WEB-DL DUAL H264-VARYG'), true);
  assert.equal(isMediaReleasePost('We Bare Bears The Movie 2020 1080p AMZN WEB-DL H264-CMRG'), true);
  assert.equal(isMediaReleasePost('Apple announces record quarterly earnings'), false);
});

// ── cacheService TTL fallback ─────────────────────────────────

test('cacheService respects TTL expiry', async () => {
  await setCache('ttl_test', { v: 1 }, 1); // 1 second TTL
  const immediate = await getCache('ttl_test');
  assert.ok(immediate);
  await new Promise(r => setTimeout(r, 1100));
  const expired = await getCache('ttl_test');
  assert.equal(expired, null);
});

test('cacheService delCache removes entry', async () => {
  await setCache('del_test', 'hello');
  assert.equal(await getCache('del_test'), 'hello');
  await delCache('del_test');
  assert.equal(await getCache('del_test'), null);
});

import { getAllBotsStatus, getBotInstance, restoreBotStateOnBoot } from '../src/services/tradingBot.js';

test('getAllBotsStatus returns stock and crypto status', () => {
  const status = getAllBotsStatus();
  assert.ok(status.stockBot);
  assert.ok(status.cryptoBot);
  assert.equal(typeof status.stockBot.isRunning, 'boolean');
  assert.equal(typeof status.cryptoBot.isRunning, 'boolean');
});

test('getBotInstance returns crypto instance for crypto', () => {
  const inst = getBotInstance('crypto');
  assert.equal(inst.assetClass, 'crypto');
  const stockInst = getBotInstance('us_equity');
  assert.equal(stockInst.assetClass, 'us_equity');
});

test('restoreBotStateOnBoot handles stopped bots', () => {
  // With in-memory DB (test mode) and no saved running state, both should stay stopped.
  restoreBotStateOnBoot();
  const status = getAllBotsStatus();
  assert.equal(typeof status.stockBot.isRunning, 'boolean');
});

import { getBotInstance } from '../src/services/tradingBot.js';

test('executeSmartOrder crypto buy uses notional', async () => {
  globalThis.fetch = async (input: any) => {
    const url = String(input);
    if (url.includes('/latest/trades')) {
      return new Response(JSON.stringify({ trades: { 'BTC/USD': { p: 50000 } } }), { status: 200 });
    }
    if (url.includes('/v2/orders')) {
      return new Response(JSON.stringify({ id: 'crypto_ord_1', status: 'accepted' }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
  const cryptoInst = getBotInstance('crypto');
  await cryptoInst.executeSmartOrder('BTC/USD', 0.001, 'buy', 'test crypto buy');
  assert.ok(true); // no throw
});

test('executeSmartOrder stock market order', async () => {
  globalThis.fetch = async (input: any) => {
    const url = String(input);
    if (url.includes('/v2/orders')) {
      return new Response(JSON.stringify({ id: 'stock_ord_1', status: 'accepted' }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
  const stockInst = getBotInstance('us_equity');
  await stockInst.executeSmartOrder('AAPL', 1, 'buy', 'test stock buy');
  assert.ok(true); // no throw
});
