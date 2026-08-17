export type AccountMode = 'live' | 'paper';

export interface AlpacaCredentials {
  baseUrl: string;
  dataUrl: string;
  keyId: string;
  secretKey: string;
  mode: AccountMode;
}

export interface AlpacaAccount {
  id: string;
  account_number: string;
  status: string;
  crypto_status?: string;
  currency: string;
  buying_power: string;
  regt_buying_power: string;
  daytrading_buying_power: string;
  effective_buying_power: string;
  non_marginable_buying_power: string;
  bod_dtbp: string;
  cash: string;
  accrued_fees: string;
  portfolio_value: string;
  pattern_day_trader: boolean;
  trading_blocked: boolean;
  transfers_blocked: boolean;
  account_blocked: boolean;
  created_at: string;
  trade_suspended_by_user: boolean;
  multiplier: string;
  shorting_enabled: boolean;
  equity: string;
  last_equity: string;
  long_market_value: string;
  short_market_value: string;
  initial_margin: string;
  maintenance_margin: string;
  last_maintenance_margin: string;
  sma: string;
  daytrade_count: number;
}

export interface AlpacaPosition {
  asset_id: string;
  symbol: string;
  exchange: string;
  asset_class: string;
  avg_entry_price: string;
  qty: string;
  side: 'long' | 'short';
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  unrealized_intraday_pl: string;
  unrealized_intraday_plpc: string;
  current_price: string;
  lastday_price: string;
  change_today: string;
}

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'limit' | 'market' | 'stop_limit' | 'stop' | 'trailing_stop';
export type TimeInForce = 'cls' | 'day' | 'fok' | 'gtc' | 'ioc' | 'opg';

export interface CreateOrderParameters {
  symbol: string;
  qty?: number | string;
  notional?: number;
  side: OrderSide;
  type?: OrderType;
  time_in_force?: TimeInForce;
  limit_price?: number | string | null;
  stop_price?: number | string | null;
  extended_hours?: boolean;
  asset_class?: 'crypto' | 'us_equity';
  reason?: string;
}

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  created_at: string;
  updated_at: string;
  submitted_at: string;
  filled_at: string | null;
  expired_at: string | null;
  canceled_at: string | null;
  failed_at: string | null;
  replaced_at: string | null;
  replaced_by: string | null;
  replaces: string | null;
  asset_id: string;
  symbol: string;
  asset_class: string;
  notional: string | null;
  qty: string;
  filled_qty: string;
  filled_avg_price: string | null;
  order_class: string;
  order_type: OrderType;
  type: OrderType;
  side: OrderSide;
  time_in_force: TimeInForce;
  limit_price: string | null;
  stop_price: string | null;
  status: string;
  extended_hours: boolean;
  legs: AlpacaOrder[] | null;
  trail_percent: string | null;
  trail_price: string | null;
  hwm: string | null;
}

export interface AlpacaBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  n: number;
  vw: number;
}

export interface NewsArticle {
  id: number | string;
  headline: string;
  summary: string;
  url: string;
  symbols: string[];
  created_at: string;
  source?: string;
}

export interface StockSentiment {
  symbol: string;
  score: number; // -1.0 to +1.0
  sentiment: 'BEARISH' | 'BULLISH' | 'NEUTRAL';
  headlineCount: number;
  topHeadline: string;
  headlines: string[];
}

export interface BotConfig {
  symbol: string;
  qty: number;
  intervalSeconds: number;
  strategy: 'ma_crossover' | 'momentum' | 'news_sentiment' | 'technical';
  stopLossPercent: number;
  takeProfitPercent: number;
  trailingStopPercent?: number;
  extendedHours?: boolean;
  assetClass?: 'crypto' | 'us_equity';
  watchlist: string[];
}

export interface BotLog {
  timestamp: string;
  message: string;
  type: 'error' | 'info' | 'success' | 'warning';
}

export interface TradeSignal {
  action: 'BUY' | 'HOLD' | 'SELL';
  targetSymbol: string;
  reason: string;
  sentimentScore?: number;
}

export interface BotStatus {
  isRunning: boolean;
  config: BotConfig;
  logs: BotLog[];
}
