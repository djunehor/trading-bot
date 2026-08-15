import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

import { getAccountMode, setAccountMode, getAlpacaCredentials } from '../src/config/alpaca.js';
import { evaluateTradingStrategy, isExtendedHours } from '../src/services/tradingBot.js';
import { saveOrderDb, getOrdersDb, syncPositionsDb, getPositionsDb, saveNewsSentimentsDb, getNewsSentimentsDb, saveBotStateDb, getBotStateDb } from '../src/db/database.js';
import { app } from '../src/server.ts';

test('Alpaca Config TypeScript - Default Mode is paper', () => {
  const mode = getAccountMode();
  assert.equal(mode, 'paper');

  const creds = getAlpacaCredentials();
  assert.equal(creds.mode, 'paper');
  assert.ok(creds.baseUrl.includes('paper-api.alpaca.markets'));
});

test('Alpaca Config TypeScript - Toggle to live mode and back to paper', () => {
  process.env.ALPACA_LIVE_KEY_ID = 'test_live_key';
  process.env.ALPACA_LIVE_SECRET_KEY = 'test_live_secret';

  setAccountMode('live');
  assert.equal(getAccountMode(), 'live');
  const liveCreds = getAlpacaCredentials();
  assert.equal(liveCreds.mode, 'live');
  assert.ok(liveCreds.baseUrl.includes('api.alpaca.markets'));

  setAccountMode('paper');
  assert.equal(getAccountMode(), 'paper');
});

test('Alpaca Config TypeScript - Throw error on invalid mode', () => {
  assert.throws(() => {
    setAccountMode('invalid_mode');
  }, /Invalid account mode/);
});

test('Trading Strategy TypeScript - Momentum BUY signal', () => {
  const signal = evaluateTradingStrategy([100, 105], 'momentum');
  assert.equal(signal.action, 'BUY');
});

test('Trading Strategy TypeScript - Momentum SELL signal', () => {
  const signal = evaluateTradingStrategy([100, 94], 'momentum');
  assert.equal(signal.action, 'SELL');
});

test('Trading Strategy TypeScript - Momentum HOLD signal', () => {
  const signal = evaluateTradingStrategy([100, 100.02], 'momentum');
  assert.equal(signal.action, 'HOLD');
});

test('Extended Hours Helper - isExtendedHours returns boolean', () => {
  const isExt = isExtendedHours();
  assert.equal(typeof isExt, 'boolean');
});

test('Database Operations - saveOrderDb, getOrdersDb, syncPositionsDb, news and state', () => {
  const mockOrder = {
    id: 'db_ord_1',
    client_order_id: 'c1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    submitted_at: new Date().toISOString(),
    filled_at: null,
    expired_at: null,
    canceled_at: null,
    failed_at: null,
    replaced_at: null,
    replaced_by: null,
    replaces: null,
    asset_id: 'a1',
    symbol: 'NVDA',
    asset_class: 'us_equity',
    notional: null,
    qty: '5',
    filled_qty: '0',
    filled_avg_price: null,
    order_class: 'simple',
    order_type: 'limit',
    type: 'limit',
    side: 'buy',
    time_in_force: 'day',
    limit_price: '130.00',
    stop_price: null,
    status: 'new',
    extended_hours: true,
    legs: null,
    trail_percent: null,
    trail_price: null,
    hwm: null
  };

  saveOrderDb(mockOrder, 'paper');
  const res = getOrdersDb('paper', 500, 0);
  assert.ok(res.total >= 1);
  const savedOrder = res.data.find((o: any) => o.id === mockOrder.id);
  assert.ok(savedOrder, 'Saved order found in DB');
  assert.equal(savedOrder.symbol, 'NVDA');

  syncPositionsDb([{
    asset_id: 'pos_1',
    symbol: 'NVDA',
    exchange: 'NASDAQ',
    asset_class: 'us_equity',
    avg_entry_price: '125.00',
    qty: '5',
    side: 'long',
    market_value: '650.00',
    cost_basis: '625.00',
    unrealized_pl: '25.00',
    unrealized_plpc: '0.04',
    unrealized_intraday_pl: '5.00',
    unrealized_intraday_plpc: '0.008',
    current_price: '130.00',
    lastday_price: '129.00',
    change_today: '0.007'
  }], 'paper');

  const posDb = getPositionsDb('paper');
  assert.equal(posDb.length, 1);
  assert.equal(posDb[0].symbol, 'NVDA');

  saveNewsSentimentsDb([{
    symbol: 'NVDA',
    score: 0.85,
    sentiment: 'BULLISH',
    headlineCount: 1,
    topHeadline: 'NVDA surge'
  }]);

  const newsDb = getNewsSentimentsDb();
  assert.ok(newsDb.some(n => n.symbol === 'NVDA'));

  saveBotStateDb(true, { symbol: 'NVDA', qty: 1, intervalSeconds: 15, strategy: 'news_sentiment', stopLossPercent: 2, takeProfitPercent: 3, watchlist: [] }, 'paper');
  const state = getBotStateDb('paper');
  assert.equal(state.isRunning, true);
});
