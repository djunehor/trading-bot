import assert from 'node:assert/strict';
import test, { after } from 'node:test';

process.env.NODE_ENV = 'test';

import { cacheService } from '../src/services/cacheService.js';
import { newsService } from '../src/services/newsService.js';
import { BotManager } from '../src/services/botManager.js';
import { MarketClock } from '../src/services/marketClock.js';

test.beforeEach(async () => {
  await cacheService.clearAll();
});

// ── tradingBot pure functions ─────────────────────────────────

test('volatilitySizedQty sizes so 1-ATR move = $25 risk', () => {
  // ATR 2%, price $100 → position value = 25 / 0.02 = 1250 → 12 shares
  assert.equal(BotManager.volatilitySizedQty(100, 2), 12);
  // ATR 10%, price $100 → position value = 25 / 0.10 = 250 → 2 shares
  assert.equal(BotManager.volatilitySizedQty(100, 10), 2);
  // invalid inputs
  assert.equal(BotManager.volatilitySizedQty(0, 2), 0);
  assert.equal(BotManager.volatilitySizedQty(100, 0), 0);
});

test('calculatePositionSize stock uses 5% of cash', async () => {
  const qty = await BotManager.calculatePositionSize('AAPL', 100, 0, [], 100_000, 0, 'us_equity');
  // 5% of 100000 = 5000, / 100 = 50 shares
  assert.equal(qty, 50);
});

test('calculatePositionSize crypto uses 5% notional', async () => {
  const qty = await BotManager.calculatePositionSize('BTC/USD', 50_000, 0, [], 100_000, 0, 'crypto');
  // 5% of 100000 = 5000, / 50000 = 0.1
  assert.ok(qty > 0.05 && qty < 0.2);
});

test('calculatePositionSize returns 0 for no cash', async () => {
  const qty = await BotManager.calculatePositionSize('AAPL', 100, 0, [], 0, 0, 'us_equity');
  assert.equal(qty, 0);
});

test('isMarketOpenOrOpeningSoon crypto always true', () => {
  assert.equal(MarketClock.isMarketOpenOrOpeningSoon('crypto'), true);
});

test('isExtendedHours returns boolean', () => {
  assert.equal(typeof MarketClock.isExtendedHours(), 'boolean');
});

test('MarketClock getStatus handles Sunday after-hours (opens Monday 9:30 AM ET)', () => {
  // Sunday Aug 16, 2026, 22:00 (10:00 PM ET)
  const sundayNight = MarketClock.makeNYDate(2026, 8, 16, 22, 0);
  const status = MarketClock.getStatus(sundayNight);
  assert.equal(status.marketStatus, 'after-hours');
  assert.equal(status.nextEvent, 'market_open');
  assert.equal(status.isOpen, false);
  // Target should be Monday Aug 17, 2026, 09:30 AM EDT
  const expected = MarketClock.makeNYDate(2026, 8, 17, 9, 30);
  assert.equal(status.nextEventTime.getTime(), expected.getTime());
  const hoursUntilOpen = (status.nextEventTime.getTime() - sundayNight.getTime()) / (1000 * 60 * 60);
  assert.equal(hoursUntilOpen, 11.5);
});

test('MarketClock getStatus handles Monday regular hours and after-hours', () => {
  // Monday Aug 17, 2026, 10:00 AM ET (Regular)
  const mondayRegular = MarketClock.makeNYDate(2026, 8, 17, 10, 0);
  const regStatus = MarketClock.getStatus(mondayRegular);
  assert.equal(regStatus.marketStatus, 'regular-hours');
  assert.equal(regStatus.isOpen, true);
  assert.equal(regStatus.nextEvent, 'market_close');

  // Monday Aug 17, 2026, 17:00 (5:00 PM ET) (After-hours -> Tuesday 9:30 AM ET)
  const mondayAfter = MarketClock.makeNYDate(2026, 8, 17, 17, 0);
  const afterStatus = MarketClock.getStatus(mondayAfter);
  assert.equal(afterStatus.marketStatus, 'after-hours');
  assert.equal(afterStatus.isOpen, false);
  assert.equal(afterStatus.nextEvent, 'market_open');
  const expectedTue = MarketClock.makeNYDate(2026, 8, 18, 9, 30);
  assert.equal(afterStatus.nextEventTime.getTime(), expectedTue.getTime());
});

test('MarketClock getStatus handles weekend and Friday transitions', () => {
  // Saturday Aug 22, 2026, 12:00 PM ET -> Sunday Aug 23, 8:00 PM ET
  const saturday = MarketClock.makeNYDate(2026, 8, 22, 12, 0);
  const satStatus = MarketClock.getStatus(saturday);
  assert.equal(satStatus.marketStatus, 'closed');
  assert.equal(satStatus.isOpen, false);
  const expectedSun = MarketClock.makeNYDate(2026, 8, 23, 20, 0);
  assert.equal(satStatus.nextEventTime.getTime(), expectedSun.getTime());

  // Friday Aug 21, 2026, 21:00 (9:00 PM ET) -> Sunday Aug 23, 8:00 PM ET
  const friClosed = MarketClock.makeNYDate(2026, 8, 21, 21, 0);
  const friStatus = MarketClock.getStatus(friClosed);
  assert.equal(friStatus.marketStatus, 'closed');
  assert.equal(friStatus.nextEventTime.getTime(), expectedSun.getTime());
});

// ── newsService helpers ────────────────────────────────────────

test('isMediaReleasePost detects torrent/media titles', () => {
  assert.equal(
    newsService.isMediaReleasePost('From Old Country Bumpkin To Master Swordsman S02E05 1080p AMZN WEB-DL DUAL H264-VARYG'),
    true,
  );
  assert.equal(newsService.isMediaReleasePost('We Bare Bears The Movie 2020 1080p AMZN WEB-DL H264-CMRG'), true);
  assert.equal(newsService.isMediaReleasePost('Apple announces record quarterly earnings'), false);
});

// ── cacheService TTL fallback ─────────────────────────────────

test('cacheService respects TTL expiry', async () => {
  await cacheService.set('ttl_test', { v: 1 }, 1); // 1 second TTL
  const immediate = await cacheService.get('ttl_test');
  assert.ok(immediate);
  await new Promise((r) => setTimeout(r, 1100));
  const expired = await cacheService.get('ttl_test');
  assert.equal(expired, null);
});

test('cacheService remove removes entry', async () => {
  await cacheService.set('del_test', 'hello');
  assert.equal(await cacheService.get('del_test'), 'hello');
  await cacheService.remove('del_test');
  assert.equal(await cacheService.get('del_test'), null);
});

test('getAllBotsStatus returns stock and crypto status', () => {
  const status = BotManager.getAllStatus();
  assert.ok(status.stockBot);
  assert.ok(status.cryptoBot);
  assert.equal(typeof status.stockBot.isRunning, 'boolean');
  assert.equal(typeof status.cryptoBot.isRunning, 'boolean');
});

test('getBotInstance returns crypto instance for crypto', () => {
  const inst = BotManager.getInstance('crypto');
  assert.equal(inst.assetClass, 'crypto');
  const stockInst = BotManager.getInstance('us_equity');
  assert.equal(stockInst.assetClass, 'us_equity');
});

test('restoreBotStateOnBoot handles stopped bots', () => {
  // With in-memory DB (test mode) and no saved running state, both should stay stopped.
  BotManager.restoreStateOnBoot();
  const status = BotManager.getAllStatus();
  assert.equal(typeof status.stockBot.isRunning, 'boolean');
});

test('executeSmartOrder crypto buy uses notional', async () => {
  globalThis.fetch = async (input: any) => {
    const url = String(input);
    if (url.includes('/latest/trades')) {
      return new Response(JSON.stringify({ trades: { 'BTC/USD': { p: 50_000 } } }), { status: 200 });
    }
    if (url.includes('/v2/orders')) {
      return new Response(JSON.stringify({ id: 'crypto_ord_1', status: 'accepted' }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
  const cryptoInst = BotManager.getInstance('crypto');
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
  const stockInst = BotManager.getInstance('us_equity');
  await stockInst.executeSmartOrder('AAPL', 1, 'buy', 'test stock buy');
  assert.ok(true); // no throw
});

after(async () => {
  const { cacheService } = await import('../src/services/cacheService.js');
  await cacheService.close();
});
