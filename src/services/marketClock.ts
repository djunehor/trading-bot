/**
 * MarketClock — all market-hours logic in one place.
 * Times are Eastern (America/New_York).
 */
import { MarketSession } from '../types/enums.js';

export { MarketSession };

export interface MarketStatus {
  session: MarketSession;
  nextOpen: Date | null;
  nextClose: Date | null;
  canTrade: boolean;
  canPlaceLimitOrders: boolean;
}

function nyNow(): Date {
  const nyString = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  return new Date(nyString);
}

export function getMarketStatus(): MarketStatus {
  const now = nyNow();
  const day = now.getDay();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  if (day === 6) return { session: MarketSession.WEEKEND, nextOpen: null, nextClose: null, canTrade: false, canPlaceLimitOrders: false };
  if (day === 0 && totalMinutes < 20 * 60) return { session: MarketSession.WEEKEND, nextOpen: null, nextClose: null, canTrade: false, canPlaceLimitOrders: false };
  if (day === 5 && totalMinutes >= 20 * 60) return { session: MarketSession.WEEKEND, nextOpen: null, nextClose: null, canTrade: false, canPlaceLimitOrders: false };

  if (totalMinutes >= 4 * 60 && totalMinutes < 9 * 60 + 30) {
    return { session: MarketSession.PRE_MARKET, nextOpen: getNextRegularOpen(now), nextClose: getNextRegularClose(now), canTrade: false, canPlaceLimitOrders: true };
  }

  if (totalMinutes >= 9 * 60 + 30 && totalMinutes < 16 * 60) {
    return { session: MarketSession.REGULAR, nextOpen: null, nextClose: getNextRegularClose(now), canTrade: true, canPlaceLimitOrders: true };
  }

  if (totalMinutes >= 16 * 60 && totalMinutes < 20 * 60) {
    return { session: MarketSession.AFTER_HOURS, nextOpen: getNextRegularOpen(now), nextClose: null, canTrade: false, canPlaceLimitOrders: true };
  }

  return { session: MarketSession.CLOSED, nextOpen: getNextRegularOpen(now), nextClose: null, canTrade: false, canPlaceLimitOrders: true };
}

function getNextRegularOpen(from: Date): Date {
  const next = new Date(from);
  next.setHours(9, 30, 0, 0);
  if (from.getHours() >= 9 && from.getMinutes() >= 30) {
    next.setDate(next.getDate() + 1);
  }
  while (next.getDay() === 0 || next.getDay() === 6) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function getNextRegularClose(from: Date): Date {
  const next = new Date(from);
  next.setHours(16, 0, 0, 0);
  if (from.getHours() >= 16) {
    next.setDate(next.getDate() + 1);
  }
  while (next.getDay() === 0 || next.getDay() === 6) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

export function isMarketOpen(): boolean {
  return getMarketStatus().canTrade;
}

export function isExtendedHours(): boolean {
  const status = getMarketStatus();
  return !status.canTrade && status.canPlaceLimitOrders;
}

export function isWeekend(): boolean {
  return getMarketStatus().session === MarketSession.WEEKEND;
}
