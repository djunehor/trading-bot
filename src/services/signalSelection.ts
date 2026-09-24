import type { TechnicalSignal } from './technicalService.js';

/**
 * Chooses the strongest signal from a set of candidates, independent of the
 * order the detectors ran in.
 *
 * Precedence: BUY outranks SELL (preserves the previous de-facto behaviour where
 * every buy detector preceded every sell detector); within the same action the
 * higher-confidence signal wins; ties keep the earlier candidate.
 *
 * Kept as a pure function with no service dependencies so it is trivially
 * testable and cannot be affected by network/DB state.
 */
export function selectBestSignal(candidates: TechnicalSignal[]): TechnicalSignal | null {
  let best: TechnicalSignal | null = null;
  for (const candidate of candidates) {
    if (best === null || outranks(candidate, best)) {
      best = candidate;
    }
  }
  return best;
}

function outranks(candidate: TechnicalSignal, incumbent: TechnicalSignal): boolean {
  if (candidate.action !== incumbent.action) {
    return candidate.action === 'BUY';
  }
  return candidate.confidence > incumbent.confidence;
}
