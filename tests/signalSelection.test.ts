import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';

import { selectBestSignal } from '../src/services/signalSelection.js';
import type { TechnicalSignal } from '../src/services/technicalService.js';
import { TECH_MIN_CONFIDENCE, TECH_SELL_MIN_CONFIDENCE } from '../src/services/botConfig.js';

function sig(action: 'BUY' | 'SELL', confidence: number, reason = 'r'): TechnicalSignal {
  return {
    symbol: 'AAPL',
    action,
    confidence,
    reason,
    indicators: {
      volumeWeightedAvgPrice: 0,
      movingAvg20: 0,
      movingAvg50: null,
      relativeStrengthIndex: 0,
      bollingerLower: 0,
      bollingerUpper: 0,
      volumeRatio: 0,
      priceChangePct5Min: 0,
      belowVwap: false,
      averageTrueRange: 0,
      averageTrueRangePct: 0,
    },
  };
}

test('selectBestSignal returns null with no candidates', () => {
  assert.equal(selectBestSignal([]), null);
});

test('selectBestSignal returns the single candidate', () => {
  const only = sig('BUY', 0.55);
  assert.equal(selectBestSignal([only]), only);
});

test('selectBestSignal picks the higher-confidence signal even when it comes later', () => {
  // Regression for the gap(0.68)-before-momentum(0.70) inversion: the weaker
  // signal is listed first, but the stronger one must win.
  const gap = sig('BUY', 0.68, 'gap-and-go');
  const momentum = sig('BUY', 0.7, 'momentum');
  assert.equal(selectBestSignal([gap, momentum])?.reason, 'momentum');
});

test('selectBestSignal prefers BUY over SELL regardless of confidence', () => {
  const buy = sig('BUY', 0.55, 'golden cross');
  const sell = sig('SELL', 0.99, 'vwap breakdown');
  assert.equal(selectBestSignal([sell, buy])?.reason, 'golden cross');
});

test('selectBestSignal keeps the earlier candidate on a confidence tie', () => {
  const first = sig('BUY', 0.7, 'first');
  const second = sig('BUY', 0.7, 'second');
  assert.equal(selectBestSignal([first, second])?.reason, 'first');
});

test('exit threshold admits the technical sell detectors the entry gate rejects', () => {
  // VWAP breakdown (0.60) and RSI overbought (0.55) must clear the sell gate,
  // while remaining below the stricter buy gate — this is what was broken.
  for (const confidence of [0.6, 0.55]) {
    assert.ok(confidence >= TECH_SELL_MIN_CONFIDENCE, `SELL ${confidence} should fire`);
    assert.ok(confidence < TECH_MIN_CONFIDENCE, `SELL ${confidence} stays out of the buy gate`);
  }
  assert.equal(TECH_MIN_CONFIDENCE, 0.7);
});
