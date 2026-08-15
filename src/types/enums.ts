/**
 * Shared const enums — no magic strings anywhere.
 */

export const enum AssetClass {
  US_EQUITY = 'us_equity',
  CRYPTO = 'crypto',
}

export const enum OrderSide {
  BUY = 'buy',
  SELL = 'sell',
}

export const enum LogType {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  SUCCESS = 'success',
}

export const enum SignalAction {
  BUY = 'BUY',
  SELL = 'SELL',
  HOLD = 'HOLD',
}

export const enum MarketSession {
  CLOSED = 'closed',
  PRE_MARKET = 'pre_market',
  REGULAR = 'regular',
  AFTER_HOURS = 'after_hours',
  WEEKEND = 'weekend',
}

export const enum AccountMode {
  PAPER = 'paper',
  LIVE = 'live',
}
