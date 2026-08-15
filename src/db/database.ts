import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { AlpacaOrder, AlpacaPosition, BotConfig, BotLog, StockSentiment } from '../types/alpaca.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Database');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'trading.db');
const db = new Database(dbPath);

/* Enable WAL (Write-Ahead Logging) mode for concurrent read/write efficiency */
db.pragma('journal_mode = WAL');

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      client_order_id TEXT,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      qty REAL NOT NULL,
      filled_qty REAL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      limit_price REAL,
      stop_price REAL,
      mode TEXT NOT NULL,
      submitted_at TEXT,
      filled_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_orders_mode_status ON orders(mode, status);
    CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders(symbol);

    CREATE TABLE IF NOT EXISTS positions (
      symbol TEXT NOT NULL,
      mode TEXT NOT NULL,
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
      mode TEXT NOT NULL
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
      mode TEXT PRIMARY KEY,
      is_running INTEGER NOT NULL,
      config_json TEXT,
      starting_equity REAL,
      updated_at TEXT
    );

    /* Triggers for automatic updated_at timestamp updates on record modifications */
    CREATE TRIGGER IF NOT EXISTS trg_orders_updated_at
    AFTER UPDATE ON orders
    FOR EACH ROW
    BEGIN
      UPDATE orders SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_positions_updated_at
    AFTER UPDATE ON positions
    FOR EACH ROW
    BEGIN
      UPDATE positions SET updated_at = CURRENT_TIMESTAMP WHERE symbol = OLD.symbol AND mode = OLD.mode;
    END;

    /* Risk management state — survives restarts */
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

    /* Equity snapshots for charting — survives restarts */
    CREATE TABLE IF NOT EXISTS equity_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time TEXT NOT NULL,
      equity REAL NOT NULL,
      pl REAL NOT NULL,
      mode TEXT NOT NULL DEFAULT 'paper',
      positions_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE INDEX IF NOT EXISTS idx_equity_snapshots_time ON equity_snapshots(time DESC);
  `);

  try { db.exec(`ALTER TABLE orders ADD COLUMN client_order_id TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN limit_price REAL;`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN stop_price REAL;`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN filled_qty REAL;`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN submitted_at TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN filled_at TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN reason TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE positions ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP;`); } catch {}
  try { db.exec(`ALTER TABLE bot_state ADD COLUMN starting_equity REAL;`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN asset_class TEXT DEFAULT 'us_equity';`); } catch {}
  try { db.exec(`ALTER TABLE positions ADD COLUMN asset_class TEXT DEFAULT 'us_equity';`); } catch {}
  try { db.exec(`ALTER TABLE bot_logs ADD COLUMN asset_class TEXT DEFAULT 'us_equity';`); } catch {}
  try { db.exec(`ALTER TABLE bot_risk_state ADD COLUMN last_sell_time TEXT`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN filled_avg_price REAL;`); } catch {}

  log.info(`SQLite database initialized successfully (${dbPath}).`);
}

// Execute schema setup on module load
initDatabase();

export function saveOrderDb(order: AlpacaOrder, mode: string = 'paper', reason?: string): void {
  if (!order || !order.id || !order.symbol) return;

  // Symbol-based check first: Alpaca may return 'us_equity' for crypto when asset_class isn't in the payload
  const assetClass = (order.symbol && order.symbol.includes('/')) ? 'crypto' : (order.asset_class || 'us_equity');

  const stmt = db.prepare(`
    INSERT INTO orders (
      id, client_order_id, symbol, side, qty, filled_qty, type, status,
      limit_price, stop_price, mode, asset_class, submitted_at, filled_at, filled_avg_price, reason, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      qty = COALESCE(excluded.qty, orders.qty),
      filled_qty = excluded.filled_qty,
      filled_at = excluded.filled_at,
      filled_avg_price = COALESCE(excluded.filled_avg_price, orders.filled_avg_price),
      asset_class = excluded.asset_class,
      reason = COALESCE(excluded.reason, orders.reason)
  `);

  const now = new Date().toISOString();
  stmt.run(
    order.id,
    order.client_order_id || null,
    order.symbol,
    order.side || 'buy',
    // For notional-based orders (crypto buys), Alpaca returns qty=null. Use filled_qty if available.
    order.qty != null ? parseFloat(String(order.qty)) : (order.filled_qty != null ? parseFloat(String(order.filled_qty)) : null),
    parseFloat(String(order.filled_qty || 0)),
    order.type || 'market',
    order.status || 'new',
    order.limit_price ? parseFloat(String(order.limit_price)) : null,
    order.stop_price ? parseFloat(String(order.stop_price)) : null,
    mode,
    assetClass,
    order.submitted_at || null,
    order.filled_at || null,
    order.filled_avg_price ? parseFloat(String(order.filled_avg_price)) : null,
    reason || null,
    now
  );
}

export function getOrdersDb(mode: string = 'paper', limit: number = 50, offset: number = 0, assetClass?: string): { data: any[]; total: number } {
  if (assetClass) {
    const countStmt = db.prepare(`SELECT COUNT(*) as total FROM orders WHERE mode = ? AND asset_class = ?`);
    const total = (countStmt.get(mode, assetClass) as { total: number }).total;
    const stmt = db.prepare(`
      SELECT * FROM orders
      WHERE mode = ? AND asset_class = ?
      ORDER BY rowid DESC
      LIMIT ? OFFSET ?
    `);
    return { data: stmt.all(mode, assetClass, limit, offset), total };
  }

  const countStmt = db.prepare(`SELECT COUNT(*) as total FROM orders WHERE mode = ?`);
  const total = (countStmt.get(mode) as { total: number }).total;
  const stmt = db.prepare(`
    SELECT * FROM orders
    WHERE mode = ?
    ORDER BY rowid DESC
    LIMIT ? OFFSET ?
  `);
  return { data: stmt.all(mode, limit, offset), total };
}

export function syncPositionsDb(positions: AlpacaPosition[], mode: string = 'paper'): void {
  const deleteStmt = db.prepare(`DELETE FROM positions WHERE mode = ?`);
  const insertStmt = db.prepare(`
    INSERT INTO positions (symbol, mode, asset_class, qty, avg_entry_price, market_value, unrealized_pl, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  const transaction = db.transaction((posList: AlpacaPosition[]) => {
    deleteStmt.run(mode);
    for (const p of posList) {
      if (!p || !p.symbol) continue;
      const assetClass = p.asset_class || (p.symbol.includes('/') ? 'crypto' : 'us_equity');
      insertStmt.run(
        p.symbol,
        mode,
        assetClass,
        parseFloat(String(p.qty || 0)),
        parseFloat(String(p.avg_entry_price || 0)),
        parseFloat(String(p.market_value || 0)),
        parseFloat(String(p.unrealized_pl || 0)),
        now
      );
    }
  });

  transaction(positions);
}

export function getPositionsDb(mode: string = 'paper', assetClass?: string): any[] {
  if (assetClass) {
    const stmt = db.prepare(`SELECT * FROM positions WHERE mode = ? AND asset_class = ?`);
    return stmt.all(mode, assetClass);
  }
  const stmt = db.prepare(`SELECT * FROM positions WHERE mode = ?`);
  return stmt.all(mode);
}

export function saveBotLogDb(logEntry: BotLog, mode: string = 'paper', assetClass: string = 'us_equity'): void {
  const stmt = db.prepare(`
    INSERT INTO bot_logs (timestamp, message, type, mode, asset_class)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(logEntry.timestamp, logEntry.message, logEntry.type, mode, assetClass);
}

export function getBotLogsDb(mode: string = 'paper', limit: number = 50, offset: number = 0, assetClass?: string): { data: BotLog[]; total: number } {
  if (assetClass) {
    const countStmt = db.prepare(`SELECT COUNT(*) as total FROM bot_logs WHERE mode = ? AND asset_class = ?`);
    const total = (countStmt.get(mode, assetClass) as { total: number }).total;
    const stmt = db.prepare(`
      SELECT timestamp, message, type FROM bot_logs
      WHERE mode = ? AND asset_class = ?
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `);
    return { data: stmt.all(mode, assetClass, limit, offset) as BotLog[], total };
  }

  const countStmt = db.prepare(`SELECT COUNT(*) as total FROM bot_logs WHERE mode = ?`);
  const total = (countStmt.get(mode) as { total: number }).total;
  const stmt = db.prepare(`
    SELECT timestamp, message, type FROM bot_logs
    WHERE mode = ?
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `);
  return { data: stmt.all(mode, limit, offset) as BotLog[], total };
}

export function saveNewsSentimentsDb(sentiments: StockSentiment[]): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO news_sentiments (symbol, score, sentiment, headline_count, top_headline, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  const transaction = db.transaction((items: StockSentiment[]) => {
    for (const s of items) {
      if (!s || !s.symbol) continue;
      stmt.run(
        s.symbol,
        typeof s.score === 'number' ? s.score : 0,
        s.sentiment || 'NEUTRAL',
        s.headlineCount || 0,
        s.topHeadline || '',
        now
      );
    }
  });

  transaction(sentiments);
}

export function getNewsSentimentsDb(): StockSentiment[] {
  const stmt = db.prepare(`
    SELECT symbol, score, sentiment, headline_count as headlineCount, top_headline as topHeadline
    FROM news_sentiments
    ORDER BY score DESC
  `);

  return stmt.all() as StockSentiment[];
}

// Bot Running State Persistence & Reset Baseline
export function saveBotStateDb(isRunning: boolean, config: BotConfig, mode: string = 'paper', startingEquity?: number): void {
  const assetClass = config.assetClass || 'us_equity';
  const stateKey = `${mode}_${assetClass}`;

  if (typeof startingEquity === 'number') {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO bot_state (mode, is_running, config_json, starting_equity, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(stateKey, isRunning ? 1 : 0, JSON.stringify(config), startingEquity, new Date().toISOString());
  } else {
    const existing = getBotStateDb(mode, assetClass);
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO bot_state (mode, is_running, config_json, starting_equity, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(stateKey, isRunning ? 1 : 0, JSON.stringify(config), existing.startingEquity ?? null, new Date().toISOString());
  }
}

export function getBotStateDb(mode: string = 'paper', assetClass: string = 'us_equity'): { isRunning: boolean; config: Partial<BotConfig> | null; startingEquity: number | null } {
  try {
    const stateKey = `${mode}_${assetClass}`;
    const stmt = db.prepare(`SELECT is_running, config_json, starting_equity FROM bot_state WHERE mode = ?`);
    let row = stmt.get(stateKey) as { is_running: number; config_json: string; starting_equity?: number } | undefined;

    // Fallback lookup by mode alone for backwards compatibility
    if (!row) {
      row = stmt.get(mode) as { is_running: number; config_json: string; starting_equity?: number } | undefined;
    }

    if (!row) return { isRunning: false, config: null, startingEquity: null };

    return {
      isRunning: row.is_running === 1,
      config: JSON.parse(row.config_json || '{}'),
      startingEquity: typeof row.starting_equity === 'number' ? row.starting_equity : null
    };
  } catch {
    return { isRunning: false, config: null, startingEquity: null };
  }
}

// ── Risk management state persistence (survives restarts) ────────────

export interface BotRiskState {
  symbol: string;
  highWaterMark: number | null;
  peakStallCount: number;
  scaledOut: boolean;
  lastBuyTime: number | null;
  lastSellTime: number | null;
}

export function saveBotRiskState(mode: string, assetClass: string, symbol: string, state: Partial<BotRiskState>): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO bot_risk_state (mode, asset_class, symbol, high_water_mark, peak_stall_count, scaled_out, last_buy_time, last_sell_time, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    mode, assetClass, symbol,
    state.highWaterMark ?? null,
    state.peakStallCount ?? 0,
    state.scaledOut ? 1 : 0,
    state.lastBuyTime ? new Date(state.lastBuyTime).toISOString() : null,
    state.lastSellTime ? new Date(state.lastSellTime).toISOString() : null,
    new Date().toISOString()
  );
}

export function loadBotRiskState(mode: string, assetClass: string): BotRiskState[] {
  const stmt = db.prepare(`
    SELECT symbol, high_water_mark, peak_stall_count, scaled_out, last_buy_time, last_sell_time
    FROM bot_risk_state WHERE mode = ? AND asset_class = ?
  `);
  const rows = stmt.all(mode, assetClass) as any[];
  return rows.map((r: any) => ({
    symbol: r.symbol,
    highWaterMark: r.high_water_mark ?? null,
    peakStallCount: r.peak_stall_count || 0,
    scaledOut: r.scaled_out === 1,
    lastBuyTime: r.last_buy_time ? new Date(r.last_buy_time).getTime() : null,
    lastSellTime: r.last_sell_time ? new Date(r.last_sell_time).getTime() : null,
  }));
}

export function deleteBotRiskState(mode: string, assetClass: string, symbol: string): void {
  db.prepare('DELETE FROM bot_risk_state WHERE mode = ? AND asset_class = ? AND symbol = ?').run(mode, assetClass, symbol);
}

export function clearAllBotRiskState(mode: string): void {
  db.prepare('DELETE FROM bot_risk_state WHERE mode = ?').run(mode);
}

export function resetBotSessionDb(mode: string = 'paper', startingEquity: number = 100000): void {
  const stateStmt = db.prepare(`
    INSERT OR REPLACE INTO bot_state (mode, is_running, config_json, starting_equity, updated_at)
    VALUES (?, 0, '{}', ?, ?)
  `);
  stateStmt.run(mode, startingEquity, new Date().toISOString());

  db.prepare(`DELETE FROM orders WHERE mode = ?`).run(mode);
  db.prepare(`DELETE FROM bot_logs WHERE mode = ?`).run(mode);
  db.prepare(`DELETE FROM bot_risk_state WHERE mode = ?`).run(mode);
  log.info(`Bot session reset for mode=${mode} with starting equity $${startingEquity.toFixed(2)}.`);
}

// ── Equity Snapshots ──────────────────────────────────────────────

export function saveEquitySnapshot(equity: number, pl: number, positions: { symbol: string; pl: number; mv: number }[], mode: string = 'paper'): void {
  const stmt = db.prepare(`
    INSERT INTO equity_snapshots (time, equity, pl, mode, positions_json)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(new Date().toISOString(), equity, pl, mode, JSON.stringify(positions));

  // Keep only last 300 snapshots (~25 hours at 5-min intervals)
  const cleanup = db.prepare(`
    DELETE FROM equity_snapshots WHERE id NOT IN (
      SELECT id FROM equity_snapshots WHERE mode = ? ORDER BY id DESC LIMIT 300
    ) AND mode = ?
  `);
  cleanup.run(mode, mode);
}

export function getEquitySnapshots(mode: string = 'paper', limit: number = 300): { time: string; equity: number; pl: number; positions: { symbol: string; pl: number; mv: number }[] }[] {
  const stmt = db.prepare(`
    SELECT time, equity, pl, positions_json FROM equity_snapshots
    WHERE mode = ?
    ORDER BY id ASC
    LIMIT ?
  `);
  const rows = stmt.all(mode, limit) as { time: string; equity: number; pl: number; positions_json: string }[];
  return rows.map(r => ({
    time: r.time,
    equity: r.equity,
    pl: r.pl,
    positions: JSON.parse(r.positions_json || '[]')
  }));
}
