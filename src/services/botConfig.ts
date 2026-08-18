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
  pendingSellOrdersMap: Record<string, AlpacaOrder>;
  expiredSellOrdersMap: Record<string, boolean>;
  isMarketOpen: boolean;
  shouldLog: boolean;
}

export const BUY_COOLDOWN_MS = 15 * 60 * 1000; // 15-minute minimum cooldown per symbol
export const INDEX_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4-hour cooldown for index accumulation buys
export const RISK_CHECK_SECONDS = 30; // stop-loss / trailing-stop / take-profit runs every 30s
export const TECH_MIN_CONFIDENCE = 0.55; // act on technical signals with confidence >= 0.55
export const INDEX_ACCUMULATION_TICKERS = new Set(['SPY', 'QQQ']); // long-horizon index ETFs
export const INDEX_CASH_MIN_PCT = 40; // only accumulate indexes if cash is >40% of portfolio

// Cash-equivalent T-bill ETFs — long-term yield parking, never stop-lossed.
export const CASH_EQUIVALENT_TICKERS = new Set(['SGOV', 'BIL', 'USFR']);
export const TBILL_ALLOCATION_PCT = 0.2; // target: up to 20% of portfolio in T-bills
export const TBILL_CASH_MIN_PCT = 20; // sweep cash into T-bills only when cash > 20% of portfolio
export const TBILL_BUY_PCT = 0.1; // deploy 10% of cash per sweep

// Stop the crypto bot from opening new BUY positions — sell-only mode.
export const IS_DISABLE_CRYPTO_BUYS = true;

// Daily loss limit: halt ALL new position opens once today's realized P/L
// drops below this. Prevents death-by-a-thousand-cuts overtrading.
export const DAILY_LOSS_LIMIT = -300; // halt new buys after -$300 realized today

// Volatility-scaled sizing & profit-gated risk for volatile names.
export const VOLATILE_ATR_PCT = 3; // ATR% > 3% per bar = volatile/meme stock
export const RISK_BUDGET_PER_TRADE = 25; // a 1-ATR move should cost ~$25 regardless of volatility
export const MEME_PROFIT_SHARE = 0.5; // max volatile exposure = 50% of today's realized profit

export const DEFAULT_STOCK_CONFIG: BotConfig = {
  symbol: 'AAPL',
  qty: 1,
  intervalSeconds: 300,
  strategy: 'news_sentiment',
  stopLossPercent: 2,
  takeProfitPercent: 3,
  trailingStopPercent: 1.5,
  extendedHours: true,
  assetClass: 'us_equity',
  watchlist: [
    'AAPL',
    'NVDA',
    'TSLA',
    'MSFT',
    'AMZN',
    'META',
    'GOOGL',
    'AMD',
    'NFLX',
    'PLTR',
    'SPY',
    'QQQ',
    'QCOM',
    'DIS',
    'COIN',
    'JPM',
    'V',
    'UNH',
    'BA',
    'COST',
    'BE',
    'NOVT',
    'ZVRA',
    'SOFI',
    'ITRI',
    'DLO',
    'MU',
    'ONDS',
    'CLBT',
    'NET',
    'WSE',
    'SNDK',
    'DOCN',
  ],
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
