import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import BetterSqlite3 from 'better-sqlite3';

import { Logger } from '../services/logger.js';
import type { AlpacaOrder, AlpacaPosition, BotConfig, BotLog, StockSentiment } from '../types/alpaca.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, '../../data');

export interface BotRiskState {
  symbol: string;
  highWaterMark: number | null;
  peakStallCount: number;
  scaledOut: boolean;
  lastBuyTime: number | null;
  lastSellTime: number | null;
}

export interface DbOrder {
  id: string;
  client_order_id: string | null;
  symbol: string;
  side: string;
  qty: number | null;
  filled_qty: number | null;
  type: string;
  status: string;
  limit_price: number | null;
  stop_price: number | null;
  mode: string;
  asset_class: string;
  submitted_at: string | null;
  filled_at: string | null;
  filled_avg_price: number | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbPosition {
  symbol: string;
  mode: string;
  asset_class: string;
  qty: number;
  avg_entry_price: number;
  market_value: number | null;
  unrealized_pl: number | null;
  updated_at: string;
}

interface RiskStateRow {
  symbol: string;
  high_water_mark: number | null;
  peak_stall_count: number;
  scaled_out: number;
  last_buy_time: string | null;
  last_sell_time: string | null;
}

export class Database {
  private readonly db: BetterSqlite3.Database;

  constructor(dbPath = process.env.DB_PATH || path.join(dataDir, 'trading.db')) {
    const targetDir = path.dirname(dbPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
    Logger.info(`SQLite database initialized successfully (${dbPath}).`);
  }

  private initSchema(): void {
    this.db.exec(`
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
    `);

    this.migrate();
  }

  private migrate(): void {
    const columns = [
      { table: 'orders', column: 'client_order_id', definition: 'TEXT' },
      { table: 'orders', column: 'limit_price', definition: 'REAL' },
      { table: 'orders', column: 'stop_price', definition: 'REAL' },
      { table: 'orders', column: 'filled_qty', definition: 'REAL' },
      { table: 'orders', column: 'submitted_at', definition: 'TEXT' },
      { table: 'orders', column: 'filled_at', definition: 'TEXT' },
      { table: 'orders', column: 'reason', definition: 'TEXT' },
      { table: 'positions', column: 'updated_at', definition: 'TEXT DEFAULT CURRENT_TIMESTAMP' },
      { table: 'bot_state', column: 'starting_equity', definition: 'REAL' },
      { table: 'orders', column: 'asset_class', definition: "TEXT DEFAULT 'us_equity'" },
      { table: 'positions', column: 'asset_class', definition: "TEXT DEFAULT 'us_equity'" },
      { table: 'bot_logs', column: 'asset_class', definition: "TEXT DEFAULT 'us_equity'" },
      { table: 'bot_risk_state', column: 'last_sell_time', definition: 'TEXT' },
      { table: 'orders', column: 'filled_avg_price', definition: 'REAL' },
    ];

    for (const { table, column, definition } of columns) {
      if (!this.hasColumn(table, column)) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
      }
    }
  }

  private hasColumn(table: string, column: string): boolean {
    const tableInfo = this.db.pragma(`table_info(${table})`) as { name: string }[];
    return tableInfo.some((row) => row.name === column);
  }

  saveOrder(order: AlpacaOrder, mode = 'paper', reason?: string): void {
    if (!order?.id || !order.symbol) {
      return;
    }

    const assetClass = order.symbol && order.symbol.includes('/') ? 'crypto' : order.asset_class || 'us_equity';

    const stmt = this.db.prepare(`
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
      order.qty == null ? (order.filled_qty == null ? null : Number.parseFloat(order.filled_qty)) : Number.parseFloat(order.qty),
      Number.parseFloat(String(order.filled_qty || 0)),
      order.type || 'market',
      order.status || 'new',
      order.limit_price ? Number.parseFloat(order.limit_price) : null,
      order.stop_price ? Number.parseFloat(order.stop_price) : null,
      mode,
      assetClass,
      order.submitted_at || null,
      order.filled_at || null,
      order.filled_avg_price ? Number.parseFloat(order.filled_avg_price) : null,
      reason || null,
      now,
    );
  }

  getOrders(mode = 'paper', limit = 50, offset = 0, assetClass?: string): { data: DbOrder[]; total: number } {
    if (assetClass) {
      const countStmt = this.db.prepare(`SELECT COUNT(*) as total FROM orders WHERE mode = ? AND asset_class = ?`);
      const { total } = countStmt.get(mode, assetClass) as { total: number };
      const stmt = this.db.prepare(`
        SELECT * FROM orders WHERE mode = ? AND asset_class = ? ORDER BY rowid DESC LIMIT ? OFFSET ?
      `);
      return { data: stmt.all(mode, assetClass, limit, offset) as DbOrder[], total };
    }

    const countStmt = this.db.prepare(`SELECT COUNT(*) as total FROM orders WHERE mode = ?`);
    const { total } = countStmt.get(mode) as { total: number };
    const stmt = this.db.prepare(`
      SELECT * FROM orders WHERE mode = ? ORDER BY rowid DESC LIMIT ? OFFSET ?
    `);
    return { data: stmt.all(mode, limit, offset) as DbOrder[], total };
  }

  syncPositions(positions: AlpacaPosition[], mode = 'paper'): void {
    const deleteStmt = this.db.prepare(`DELETE FROM positions WHERE mode = ?`);
    const insertStmt = this.db.prepare(`
      INSERT INTO positions (symbol, mode, asset_class, qty, avg_entry_price, market_value, unrealized_pl, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    const transaction = this.db.transaction((posList: AlpacaPosition[]) => {
      deleteStmt.run(mode);
      for (const p of posList) {
        if (!p?.symbol) {
          continue;
        }
        const assetClass = p.asset_class || (p.symbol.includes('/') ? 'crypto' : 'us_equity');
        insertStmt.run(
          p.symbol,
          mode,
          assetClass,
          Number.parseFloat(String(p.qty || 0)),
          Number.parseFloat(String(p.avg_entry_price || 0)),
          Number.parseFloat(String(p.market_value || 0)),
          Number.parseFloat(String(p.unrealized_pl || 0)),
          now,
        );
      }
    });

    transaction(positions);
  }

  getPositions(mode = 'paper', assetClass?: string): DbPosition[] {
    if (assetClass) {
      return this.db.prepare(`SELECT * FROM positions WHERE mode = ? AND asset_class = ?`).all(mode, assetClass) as DbPosition[];
    }
    return this.db.prepare(`SELECT * FROM positions WHERE mode = ?`).all(mode) as DbPosition[];
  }

  saveBotLog(logEntry: BotLog, mode = 'paper', assetClass = 'us_equity'): void {
    this.db
      .prepare(
        `
      INSERT INTO bot_logs (timestamp, message, type, mode, asset_class) VALUES (?, ?, ?, ?, ?)
    `,
      )
      .run(logEntry.timestamp, logEntry.message, logEntry.type, mode, assetClass);
  }

  getBotLogs(mode = 'paper', limit = 50, offset = 0, assetClass?: string): { data: BotLog[]; total: number } {
    if (assetClass) {
      const countStmt = this.db.prepare(`SELECT COUNT(*) as total FROM bot_logs WHERE mode = ? AND asset_class = ?`);
      const { total } = countStmt.get(mode, assetClass) as { total: number };
      const stmt = this.db.prepare(`
        SELECT timestamp, message, type FROM bot_logs WHERE mode = ? AND asset_class = ? ORDER BY id DESC LIMIT ? OFFSET ?
      `);
      return { data: stmt.all(mode, assetClass, limit, offset) as BotLog[], total };
    }

    const countStmt = this.db.prepare(`SELECT COUNT(*) as total FROM bot_logs WHERE mode = ?`);
    const { total } = countStmt.get(mode) as { total: number };
    const stmt = this.db.prepare(`
      SELECT timestamp, message, type FROM bot_logs WHERE mode = ? ORDER BY id DESC LIMIT ? OFFSET ?
    `);
    return { data: stmt.all(mode, limit, offset) as BotLog[], total };
  }

  saveNewsSentiments(sentiments: StockSentiment[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO news_sentiments (symbol, score, sentiment, headline_count, top_headline, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    const transaction = this.db.transaction((items: StockSentiment[]) => {
      for (const s of items) {
        if (!s?.symbol) {
          continue;
        }
        stmt.run(
          s.symbol,
          typeof s.score === 'number' ? s.score : 0,
          s.sentiment || 'NEUTRAL',
          s.headlineCount || 0,
          s.topHeadline || '',
          now,
        );
      }
    });

    transaction(sentiments);
  }

  getNewsSentiments(): StockSentiment[] {
    return this.db
      .prepare(
        `
      SELECT symbol, score, sentiment, headline_count as headlineCount, top_headline as topHeadline
      FROM news_sentiments ORDER BY score DESC
    `,
      )
      .all() as StockSentiment[];
  }

  saveBotState(isRunning: boolean, config: BotConfig, mode = 'paper', startingEquity?: number): void {
    const assetClass = config.assetClass || 'us_equity';
    const stateKey = `${mode}_${assetClass}`;

    if (typeof startingEquity === 'number') {
      this.db
        .prepare(
          `
        INSERT OR REPLACE INTO bot_state (mode, is_running, config_json, starting_equity, updated_at) VALUES (?, ?, ?, ?, ?)
      `,
        )
        .run(stateKey, isRunning ? 1 : 0, JSON.stringify(config), startingEquity, new Date().toISOString());
    } else {
      const existing = this.getBotState(mode, assetClass);
      this.db
        .prepare(
          `
        INSERT OR REPLACE INTO bot_state (mode, is_running, config_json, starting_equity, updated_at) VALUES (?, ?, ?, ?, ?)
      `,
        )
        .run(stateKey, isRunning ? 1 : 0, JSON.stringify(config), existing.startingEquity ?? null, new Date().toISOString());
    }
  }

  getBotState(
    mode = 'paper',
    assetClass = 'us_equity',
  ): { isRunning: boolean; config: Partial<BotConfig> | null; startingEquity: number | null } {
    try {
      const stateKey = `${mode}_${assetClass}`;
      const stmt = this.db.prepare(`SELECT is_running, config_json, starting_equity FROM bot_state WHERE mode = ?`);
      let row = stmt.get(stateKey) as { is_running: number; config_json: string; starting_equity?: number } | undefined;

      if (!row) {
        row = stmt.get(mode) as { is_running: number; config_json: string; starting_equity?: number } | undefined;
      }

      if (!row) {
        return { isRunning: false, config: null, startingEquity: null };
      }

      return {
        isRunning: row.is_running === 1,
        config: JSON.parse(row.config_json || '{}'),
        startingEquity: typeof row.starting_equity === 'number' ? row.starting_equity : null,
      };
    } catch {
      return { isRunning: false, config: null, startingEquity: null };
    }
  }

  saveRiskState(mode: string, assetClass: string, symbol: string, state: Partial<BotRiskState>): void {
    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO bot_risk_state (mode, asset_class, symbol, high_water_mark, peak_stall_count, scaled_out, last_buy_time, last_sell_time, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        mode,
        assetClass,
        symbol,
        state.highWaterMark ?? null,
        state.peakStallCount ?? 0,
        state.scaledOut ? 1 : 0,
        state.lastBuyTime ? new Date(state.lastBuyTime).toISOString() : null,
        state.lastSellTime ? new Date(state.lastSellTime).toISOString() : null,
        new Date().toISOString(),
      );
  }

  loadRiskState(mode: string, assetClass: string): BotRiskState[] {
    const rows = this.db
      .prepare(
        `
      SELECT symbol, high_water_mark, peak_stall_count, scaled_out, last_buy_time, last_sell_time
      FROM bot_risk_state WHERE mode = ? AND asset_class = ?
    `,
      )
      .all(mode, assetClass) as RiskStateRow[];

    return rows.map((row: RiskStateRow) => ({
      symbol: row.symbol,
      highWaterMark: row.high_water_mark ?? null,
      peakStallCount: row.peak_stall_count || 0,
      scaledOut: row.scaled_out === 1,
      lastBuyTime: row.last_buy_time ? new Date(row.last_buy_time).getTime() : null,
      lastSellTime: row.last_sell_time ? new Date(row.last_sell_time).getTime() : null,
    }));
  }

  deleteRiskState(mode: string, assetClass: string, symbol: string): void {
    this.db.prepare('DELETE FROM bot_risk_state WHERE mode = ? AND asset_class = ? AND symbol = ?').run(mode, assetClass, symbol);
  }

  clearAllRiskState(mode: string): void {
    this.db.prepare('DELETE FROM bot_risk_state WHERE mode = ?').run(mode);
  }

  resetSession(mode = 'paper', startingEquity: number): void {
    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO bot_state (mode, is_running, config_json, starting_equity, updated_at) VALUES (?, 0, '{}', ?, ?)
    `,
      )
      .run(mode, startingEquity, new Date().toISOString());

    this.db.prepare(`DELETE FROM orders WHERE mode = ?`).run(mode);
    this.db.prepare(`DELETE FROM bot_logs WHERE mode = ?`).run(mode);
    this.db.prepare(`DELETE FROM bot_risk_state WHERE mode = ?`).run(mode);
    Logger.info(`Bot session reset for mode=${mode} with starting equity $${startingEquity.toFixed(2)}.`);
  }

  clearTable(table: string): void {
    this.db.prepare(`DELETE FROM ${table}`).run();
  }

  saveEquitySnapshot(equity: number, pl: number, positions: { symbol: string; pl: number; mv: number }[], mode = 'paper'): void {
    this.db
      .prepare(
        `
      INSERT INTO equity_snapshots (time, equity, pl, mode, positions_json) VALUES (?, ?, ?, ?, ?)
    `,
      )
      .run(new Date().toISOString(), equity, pl, mode, JSON.stringify(positions));

    const cleanup = this.db.prepare(`
      DELETE FROM equity_snapshots WHERE id NOT IN (
        SELECT id FROM equity_snapshots WHERE mode = ? ORDER BY id DESC LIMIT 300
      ) AND mode = ?
    `);
    cleanup.run(mode, mode);
  }

  getEquitySnapshots(
    mode = 'paper',
    limit = 300,
  ): { time: string; equity: number; pl: number; positions: { symbol: string; pl: number; mv: number }[] }[] {
    const rows = this.db
      .prepare(
        `
      SELECT time, equity, pl, positions_json FROM equity_snapshots WHERE mode = ? ORDER BY id ASC LIMIT ?
    `,
      )
      .all(mode, limit) as { time: string; equity: number; pl: number; positions_json: string }[];

    return rows.map((row) => ({
      time: row.time,
      equity: row.equity,
      pl: row.pl,
      positions: JSON.parse(row.positions_json || '[]'),
    }));
  }
}

export const database = new Database();
