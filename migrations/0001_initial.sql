-- Cloudflare D1 Migration: Initial Trading Automation Schema

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  client_order_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  qty REAL,
  filled_qty REAL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  limit_price REAL,
  stop_price REAL,
  mode TEXT NOT NULL,
  asset_class TEXT DEFAULT 'us_equity',
  submitted_at TEXT,
  filled_at TEXT,
  filled_avg_price REAL,
  reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_mode_status ON orders(mode, status);
CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders(symbol);
CREATE INDEX IF NOT EXISTS idx_orders_submitted ON orders(submitted_at DESC);

CREATE TABLE IF NOT EXISTS positions (
  symbol TEXT NOT NULL,
  mode TEXT NOT NULL,
  asset_class TEXT DEFAULT 'us_equity',
  qty REAL NOT NULL,
  avg_entry_price REAL NOT NULL,
  market_value REAL,
  unrealized_pl REAL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (symbol, mode)
);

CREATE TABLE IF NOT EXISTS bot_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL,
  mode TEXT NOT NULL,
  asset_class TEXT DEFAULT 'us_equity'
);

CREATE INDEX IF NOT EXISTS idx_bot_logs_mode_timestamp ON bot_logs(mode, timestamp DESC);

CREATE TABLE IF NOT EXISTS news_sentiments (
  symbol TEXT PRIMARY KEY,
  score REAL NOT NULL,
  sentiment TEXT NOT NULL,
  headline_count INTEGER NOT NULL,
  top_headline TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_news_sentiments_score ON news_sentiments(score DESC);

CREATE TABLE IF NOT EXISTS bot_state (
  mode TEXT NOT NULL,
  asset_class TEXT NOT NULL DEFAULT 'us_equity',
  is_running INTEGER NOT NULL,
  config_json TEXT,
  starting_equity REAL,
  updated_at TEXT,
  PRIMARY KEY (mode, asset_class)
);

CREATE TABLE IF NOT EXISTS bot_risk_state (
  mode TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  symbol TEXT NOT NULL,
  high_water_mark REAL,
  peak_stall_count INTEGER DEFAULT 0,
  scaled_out INTEGER DEFAULT 0,
  last_buy_time TEXT,
  last_sell_time TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (mode, asset_class, symbol)
);

CREATE TABLE IF NOT EXISTS equity_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time TEXT NOT NULL,
  equity REAL NOT NULL,
  pl REAL NOT NULL,
  mode TEXT NOT NULL DEFAULT 'paper',
  positions_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_equity_snapshots_time ON equity_snapshots(time DESC);
