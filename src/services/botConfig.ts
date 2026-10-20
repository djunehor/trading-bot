import type { AlpacaOrder, BotConfig } from '../types/alpaca.js';

/**
 * Strip slashes for symbol matching: Alpaca positions use SOLUSD, orders/signals use SOL/USD.
 */
export function matchKey(symbol: string): string {
  return symbol.replace('/', '').toUpperCase();
}

export interface PositionSnapshot {
  symbol: string;
  qty: number;
  currentPrice: number;
  avgEntryPrice: number;
  gainPercent: number;
  plDollars: number;
  currentPeak: number;
  dropFromPeakPercent: number;
  scaleOutThreshold: number;
  effectiveStopLoss: number;
  effectiveTakeProfit: number;
  effectiveTrailing: number;
}

export interface PositionRiskContext {
  pendingOrdersMap: Record<string, AlpacaOrder>;
  pendingSellOrdersMap: Record<string, AlpacaOrder>;
  expiredSellOrdersMap: Record<string, boolean>;
  isMarketOpen: boolean;
  shouldLog: boolean;
}

export const BUY_COOLDOWN_MS = 15 * 60 * 1000; // 15-minute minimum cooldown per symbol
export const INDEX_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4-hour cooldown for index accumulation buys
export const RISK_CHECK_SECONDS = 30; // stop-loss / trailing-stop / take-profit runs every 30s
export const TECH_MIN_CONFIDENCE = 0.7; // act only on strong technical BUY signals (was 0.55 — too trigger-happy)

// Exits use a lower bar than entries. The sell detectors (VWAP breakdown 0.60,
// RSI overbought 0.55) sit deliberately below the entry threshold; gating exits
// at 0.7 silently disabled every technical sell for ~5 weeks.
export const TECH_SELL_MIN_CONFIDENCE = 0.55;
// Preserve at least 20% cash as seed capital to recover from drawdowns.
export const MIN_CASH_RESERVE_PCT = 20;

export const INDEX_ACCUMULATION_TICKERS = new Set(['SPY', 'QQQ']); // long-horizon index ETFs
export const INDEX_ALLOCATION_PCT = 0.35; // target: up to 35% of portfolio in index ETFs
export const INDEX_CASH_MIN_PCT = 20; // only accumulate indexes if cash is > 20% of portfolio
export const INDEX_BUY_PCT = 0.15; // deploy 15% of deployable cash per index accumulation buy

// Cash-equivalent T-bill ETFs — long-term yield parking, never stop-lossed.
export const CASH_EQUIVALENT_TICKERS = new Set(['SGOV', 'BIL', 'USFR']);
export const TBILL_ALLOCATION_PCT = 0.25; // target: up to 25% of portfolio in T-bills (was 15)
export const TBILL_CASH_MIN_PCT = 20; // sweep cash into T-bills only when cash > 20% of portfolio
export const TBILL_BUY_PCT = 0.15; // deploy 15% of deployable cash per sweep (was 10)

// Active swing trading per-trade size (fraction of deployable cash)
export const ACTIVE_TRADE_CASH_PCT = 0.1; // deploy 10% of deployable cash per active trade (was 7% of total cash)

// Stop the crypto bot from opening new BUY positions — sell-only mode.
export const IS_DISABLE_CRYPTO_BUYS = true;

// Daily loss limit: halt ALL new position opens once today's realized P/L
// drops below this. Prevents death-by-a-thousand-cuts overtrading.
export const DAILY_LOSS_LIMIT = -300; // halt new buys after -$300 realized today

// Volatility-scaled sizing & profit-gated risk for volatile names.
export const VOLATILE_ATR_PCT = 3; // ATR% > 3% per bar = volatile/meme stock
export const RISK_BUDGET_PER_TRADE = 25; // a 1-ATR move should cost ~$25 regardless of volatility
export const MEME_PROFIT_SHARE = 0.3; // max volatile exposure = 30% of today's realized profit

// ── Risk-on sleeve ──────────────────────────────────────────────────────────
// Re-enables aggressive high-beta momentum entries, but ONLY when the broad
// market is in an uptrend and ONLY within hard factor-exposure caps.
// DISABLED by default: when false, every sleeve check is a strict no-op and the
// bot behaves exactly as it did before this feature existed.
export const RISK_ON_SLEEVE_ENABLED = false;

// High-beta / momentum-driven names. The sleeve caps aggregate exposure to
// these regardless of how much cash is available.
export const HIGH_BETA_TICKERS = new Set(['PLTR', 'AMD', 'COIN', 'TSLA', 'NVDA', 'MU', 'NFLX', 'META']);

// Hard caps on the high-beta factor sleeve (correlation is the real risk here,
// not any single position).
export const MAX_HIGH_BETA_EQUITY_PCT = 0.25; // ≤25% of equity across all high-beta names
export const MAX_HIGH_BETA_NAMES = 5; // ≤5 concurrent high-beta positions

// Regime gate: the sleeve may only open when SPY trades above its N-session SMA.
export const REGIME_SYMBOL = 'SPY';
export const REGIME_SMA_PERIOD = 20;
export const REGIME_CACHE_MS = 5 * 60 * 1000; // re-check at most every 5 minutes

// When the daily loss limit trips, optionally flatten the high-beta sleeve.
// Default false = "shadow mode": log what WOULD be flattened but take no action.
export const SLEEVE_FLATTEN_ON_BREACH = false;

// Mature, liquid universe — the ONLY names the bot should trade by default.
// Long-term ETFs (S&P 500, Nasdaq) + mega/large-cap stocks. No meme stocks,
// no micro-caps, no leveraged ETFs.
export const MATURE_STOCK_WATCHLIST = [
  'SPY',
  'QQQ',
  'AAPL',
  'MSFT',
  'NVDA',
  'GOOGL',
  'AMZN',
  'META',
  'TSLA',
  'AMD',
  'NFLX',
  'JPM',
  'V',
  'UNH',
  'COST',
  'DIS',
  'BA',
  'QCOM',
  'MU',
  'PLTR',
];

export const DEFAULT_STOCK_CONFIG: BotConfig = {
  symbol: 'AAPL',
  qty: 1,
  intervalSeconds: 300,
  strategy: 'news_sentiment',
  stopLossPercent: 4,
  takeProfitPercent: 8,
  trailingStopPercent: 3,
  extendedHours: true,
  assetClass: 'us_equity',
  watchlist: MATURE_STOCK_WATCHLIST,
};

export const DEFAULT_CRYPTO_WATCHLIST = [
  'BTC/USD',
  'ETH/USD',
  'SOL/USD',
  'DOGE/USD',
  'AVAX/USD',
  'LINK/USD',
  'UNI/USD',
  'BCH/USD',
  'LTC/USD',
  'DOT/USD',
];

export const DEFAULT_CRYPTO_CONFIG: BotConfig = {
  symbol: 'BTC/USD',
  qty: 1,
  intervalSeconds: 300,
  strategy: 'momentum',
  stopLossPercent: 1.5,
  takeProfitPercent: 3,
  trailingStopPercent: 1.5,
  extendedHours: false,
  assetClass: 'crypto',
  watchlist: DEFAULT_CRYPTO_WATCHLIST,
};
