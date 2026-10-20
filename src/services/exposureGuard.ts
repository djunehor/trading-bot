import {
  HIGH_BETA_TICKERS,
  MAX_HIGH_BETA_EQUITY_PCT,
  MAX_HIGH_BETA_NAMES,
  matchKey,
} from './botConfig.js';
import type { AlpacaPosition } from '../types/alpaca.js';

export interface ExposureDecision {
  allowed: boolean;
  reason: string;
  currentPct: number;
  currentNames: number;
  projectedPct: number;
}

export function isHighBeta(symbol: string): boolean {
  return HIGH_BETA_TICKERS.has(matchKey(symbol));
}

/**
 * Portfolio-level factor cap for the high-beta sleeve.
 *
 * The Aug-7 event was ~10 correlated high-beta names moving together — the risk
 * is aggregate factor exposure, not any single position. Per-name stops cannot
 * see that, so this caps it directly by dollars and by name count.
 */
export function evaluateHighBetaExposure(
  positions: AlpacaPosition[],
  equity: number,
  candidateSymbol: string,
  candidateNotional: number,
): ExposureDecision {
  const empty: ExposureDecision = {
    allowed: true,
    reason: 'not a high-beta name',
    currentPct: 0,
    currentNames: 0,
    projectedPct: 0,
  };

  if (!isHighBeta(candidateSymbol)) {
    return empty;
  }

  if (!(equity > 0)) {
    return { ...empty, allowed: false, reason: `non-positive equity (${equity})` };
  }

  // Dedupe by matchKey: buildPositionMap stores each position under two keys.
  const heldByKey = new Map<string, number>();
  for (const position of positions) {
    if (isHighBeta(position.symbol) && Number(position.qty) > 0) {
      heldByKey.set(matchKey(position.symbol), Math.abs(Number(position.market_value) || 0));
    }
  }

  const currentValue = [...heldByKey.values()].reduce((sum, value) => sum + value, 0);
  const currentNames = heldByKey.size;
  const currentPct = currentValue / equity;
  const isNewName = !heldByKey.has(matchKey(candidateSymbol));

  if (isNewName && currentNames >= MAX_HIGH_BETA_NAMES) {
    return {
      allowed: false,
      reason: `already holding ${currentNames} high-beta names (cap ${MAX_HIGH_BETA_NAMES})`,
      currentPct,
      currentNames,
      projectedPct: currentPct,
    };
  }

  const projectedPct = (currentValue + Math.max(0, candidateNotional)) / equity;
  if (projectedPct > MAX_HIGH_BETA_EQUITY_PCT) {
    return {
      allowed: false,
      reason: `high-beta exposure would reach ${(projectedPct * 100).toFixed(1)}% (cap ${(MAX_HIGH_BETA_EQUITY_PCT * 100).toFixed(0)}%)`,
      currentPct,
      currentNames,
      projectedPct,
    };
  }

  return { allowed: true, reason: 'within high-beta caps', currentPct, currentNames, projectedPct };
}
