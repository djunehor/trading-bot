import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';

import { evaluateHighBetaExposure, isHighBeta } from '../src/services/exposureGuard.js';
import type { AlpacaPosition } from '../src/types/alpaca.js';

function pos(symbol: string, qty: number, marketValue: number): AlpacaPosition {
  return {
    asset_id: symbol,
    symbol,
    exchange: 'NASDAQ',
    asset_class: 'us_equity',
    avg_entry_price: '100',
    qty: String(qty),
    side: 'long',
    market_value: String(marketValue),
    cost_basis: '0',
    unrealized_pl: '0',
    unrealized_plpc: '0',
    unrealized_intraday_pl: '0',
    unrealized_intraday_plpc: '0',
    current_price: '100',
    lastday_price: '100',
    change_today: '0',
  };
}

test('ExposureGuard - identifies high-beta names case-insensitively', () => {
  assert.equal(isHighBeta('PLTR'), true);
  assert.equal(isHighBeta('pltr'), true);
  assert.equal(isHighBeta('SPY'), false);
});

test('ExposureGuard - non-high-beta names always pass', () => {
  const decision = evaluateHighBetaExposure([], 100_000, 'SPY', 50_000);
  assert.equal(decision.allowed, true);
});

test('ExposureGuard - allows a first high-beta entry within caps', () => {
  const decision = evaluateHighBetaExposure([], 100_000, 'PLTR', 10_000);
  assert.equal(decision.allowed, true);
  assert.equal(decision.currentNames, 0);
  assert.ok(Math.abs(decision.projectedPct - 0.1) < 1e-9);
});

test('ExposureGuard - blocks when the dollar cap would be breached', () => {
  // Already $20k of high-beta on $100k equity; adding $10k would be 30% > 25%.
  const held = [pos('PLTR', 100, 20_000)];
  const decision = evaluateHighBetaExposure(held, 100_000, 'AMD', 10_000);
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /exposure would reach/);
});

test('ExposureGuard - allows an add to an existing name even at the name cap', () => {
  const held = ['PLTR', 'AMD', 'COIN', 'TSLA', 'NVDA'].map((s) => pos(s, 1, 1_000));
  // 5 names already held; adding to an existing name must not trip the count cap.
  const decision = evaluateHighBetaExposure(held, 1_000_000, 'PLTR', 1_000);
  assert.equal(decision.allowed, true);
});

test('ExposureGuard - blocks a sixth new high-beta name', () => {
  const held = ['PLTR', 'AMD', 'COIN', 'TSLA', 'NVDA'].map((s) => pos(s, 1, 1_000));
  const decision = evaluateHighBetaExposure(held, 1_000_000, 'MU', 1_000);
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /high-beta names/);
});

test('ExposureGuard - blocks on non-positive equity', () => {
  const decision = evaluateHighBetaExposure([], 0, 'PLTR', 1_000);
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /non-positive equity/);
});

test('ExposureGuard - dedupes duplicate positionMap entries', () => {
  const held = [pos('PLTR', 100, 10_000), pos('PLTR', 100, 10_000)];
  const decision = evaluateHighBetaExposure(held, 100_000, 'AMD', 1_000);
  assert.equal(decision.currentNames, 1);
  assert.ok(Math.abs(decision.currentPct - 0.1) < 1e-9);
});

test('ExposureGuard - ignores closed positions and missing market values', () => {
  const closed = pos('PLTR', 0, 50_000);
  const zeroValue = { ...pos('AMD', 10, 0), market_value: null as unknown as string };
  const decision = evaluateHighBetaExposure([closed, zeroValue], 100_000, 'MU', 1_000);
  assert.equal(decision.allowed, true);
  assert.equal(decision.currentNames, 1);
  assert.equal(decision.currentPct, 0);
});

test('ExposureGuard - allows an entry that lands exactly on the cap', () => {
  const held = [pos('PLTR', 100, 15_000)];
  const decision = evaluateHighBetaExposure(held, 100_000, 'AMD', 10_000);
  assert.equal(decision.allowed, true);
  assert.ok(Math.abs(decision.projectedPct - 0.25) < 1e-9);
});
