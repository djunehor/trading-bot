import assert from 'node:assert/strict';
import test, { after } from 'node:test';

process.env.NODE_ENV = 'test';

import { Database } from '../src/db/database.js';

const database = new Database(':memory:');

test('Database - Order CRUD operations', () => {
  const mockOrder: any = {
    id: 'db_ord_1',
    symbol: 'AAPL',
    side: 'buy',
    qty: '5',
    type: 'market',
    status: 'accepted',
    submitted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  database.saveOrder(mockOrder, 'paper');
  const paginatedOrders = database.getOrders('paper');
  assert.ok(paginatedOrders.data.length > 0);
  const found = paginatedOrders.data.find((o) => o.id === 'db_ord_1');
  assert.ok(found);
  assert.equal(found.symbol, 'AAPL');
});

test('Database - Position sync operations', () => {
  const mockPositions: any[] = [{ symbol: 'NVDA', qty: '10', avg_entry_price: '200.00', market_value: '2000.00', unrealized_pl: '100.00' }];

  database.syncPositions(mockPositions, 'paper');
  const positions = database.getPositions('paper');
  assert.equal(positions.length, 1);
  assert.equal(positions[0].symbol, 'NVDA');
});

test('Database - Bot Log persistence operations', () => {
  const mockLog = {
    timestamp: new Date().toISOString(),
    message: 'Test automated log entry',
    type: 'info' as const,
  };

  database.saveBotLog(mockLog, 'paper');
  const paginatedLogs = database.getBotLogs('paper');
  assert.ok(paginatedLogs.data.length > 0);
  assert.ok(paginatedLogs.data.some((l) => l.message === 'Test automated log entry'));
});

test('Database - News Sentiment persistence operations', () => {
  const mockSentiments: any[] = [
    { symbol: 'TSLA', score: 0.85, sentiment: 'BULLISH', headlineCount: 5, topHeadline: 'TSLA record deliveries' },
  ];

  database.saveNewsSentiments(mockSentiments);
  const sentiments = database.getNewsSentiments();
  assert.ok(sentiments.length > 0);
  const found = sentiments.find((s) => s.symbol === 'TSLA');
  assert.ok(found);
  assert.equal(found.score, 0.85);
});
