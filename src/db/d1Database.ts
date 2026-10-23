import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { AlpacaOrder, AlpacaPosition, BotConfig, BotLog, StockSentiment } from '../types/alpaca.js';
import type { BotRiskState, DbOrder, DbPosition } from './database.js';

interface RiskStateRow {
  symbol: string;
  high_water_mark: number | null;
  peak_stall_count: number;
  scaled_out: number;
  last_buy_time: string | null;
  last_sell_time: string | null;
}

export class D1DatabaseService {
  constructor(private readonly d1: D1Database) {}

  async saveOrder(order: AlpacaOrder, mode = 'paper', reason?: string): Promise<void> {
    if (!order?.id || !order.symbol) {
      return;
    }

    const assetClass = order.symbol && order.symbol.includes('/') ? 'crypto' : order.asset_class || 'us_equity';
    const now = new Date().toISOString();

    const sql = `
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
    `;

    await this.d1
      .prepare(sql)
      .bind(
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
      )
      .run();
  }

  async getOrders(mode = 'paper', limit = 50, offset = 0, assetClass?: string): Promise<{ data: DbOrder[]; total: number }> {
    if (assetClass) {
      const countRes = await this.d1
        .prepare(`SELECT COUNT(*) as total FROM orders WHERE mode = ? AND asset_class = ?`)
        .bind(mode, assetClass)
        .first<{ total: number }>();
      const total = countRes?.total ?? 0;

      const listRes = await this.d1
        .prepare(`SELECT * FROM orders WHERE mode = ? AND asset_class = ? ORDER BY rowid DESC LIMIT ? OFFSET ?`)
        .bind(mode, assetClass, limit, offset)
        .all<DbOrder>();

      return { data: listRes.results, total };
    }

    const countRes = await this.d1
      .prepare(`SELECT COUNT(*) as total FROM orders WHERE mode = ?`)
      .bind(mode)
      .first<{ total: number }>();
    const total = countRes?.total ?? 0;

    const listRes = await this.d1
      .prepare(`SELECT * FROM orders WHERE mode = ? ORDER BY rowid DESC LIMIT ? OFFSET ?`)
      .bind(mode, limit, offset)
      .all<DbOrder>();

    return { data: listRes.results, total };
  }

  async syncPositions(positions: AlpacaPosition[], mode = 'paper'): Promise<void> {
    const now = new Date().toISOString();
    const stmts: D1PreparedStatement[] = [
      this.d1.prepare(`DELETE FROM positions WHERE mode = ?`).bind(mode),
    ];

    for (const p of positions) {
      if (!p?.symbol) continue;
      const assetClass = p.asset_class || (p.symbol.includes('/') ? 'crypto' : 'us_equity');
      stmts.push(
        this.d1
          .prepare(
            `INSERT INTO positions (symbol, mode, asset_class, qty, avg_entry_price, market_value, unrealized_pl, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            p.symbol,
            mode,
            assetClass,
            Number.parseFloat(String(p.qty || 0)),
            Number.parseFloat(String(p.avg_entry_price || 0)),
            Number.parseFloat(String(p.market_value || 0)),
            Number.parseFloat(String(p.unrealized_pl || 0)),
            now,
          )
      );
    }

    await this.d1.batch(stmts);
  }

  async getPositions(mode = 'paper', assetClass?: string): Promise<DbPosition[]> {
    if (assetClass) {
      const res = await this.d1
        .prepare(`SELECT * FROM positions WHERE mode = ? AND asset_class = ?`)
        .bind(mode, assetClass)
        .all<DbPosition>();
      return res.results;
    }
    const res = await this.d1
      .prepare(`SELECT * FROM positions WHERE mode = ?`)
      .bind(mode)
      .all<DbPosition>();
    return res.results;
  }

  async saveBotLog(logEntry: BotLog, mode = 'paper', assetClass = 'us_equity'): Promise<void> {
    await this.d1
      .prepare(
        `INSERT INTO bot_logs (timestamp, message, type, mode, asset_class) VALUES (?, ?, ?, ?, ?)`
      )
      .bind(logEntry.timestamp, logEntry.message, logEntry.type, mode, assetClass)
      .run();
  }

  async getBotLogs(mode = 'paper', limit = 50, offset = 0, assetClass?: string): Promise<{ data: BotLog[]; total: number }> {
    if (assetClass) {
      const countRes = await this.d1
        .prepare(`SELECT COUNT(*) as total FROM bot_logs WHERE mode = ? AND asset_class = ?`)
        .bind(mode, assetClass)
        .first<{ total: number }>();
      const total = countRes?.total ?? 0;

      const listRes = await this.d1
        .prepare(
          `SELECT timestamp, message, type FROM bot_logs WHERE mode = ? AND asset_class = ? ORDER BY id DESC LIMIT ? OFFSET ?`
        )
        .bind(mode, assetClass, limit, offset)
        .all<BotLog>();

      return { data: listRes.results, total };
    }

    const countRes = await this.d1
      .prepare(`SELECT COUNT(*) as total FROM bot_logs WHERE mode = ?`)
      .bind(mode)
      .first<{ total: number }>();
    const total = countRes?.total ?? 0;

    const listRes = await this.d1
      .prepare(`SELECT timestamp, message, type FROM bot_logs WHERE mode = ? ORDER BY id DESC LIMIT ? OFFSET ?`)
      .bind(mode, limit, offset)
      .all<BotLog>();

    return { data: listRes.results, total };
  }

  async saveNewsSentiments(sentiments: StockSentiment[]): Promise<void> {
    const now = new Date().toISOString();
    const stmts: D1PreparedStatement[] = [];

    for (const s of sentiments) {
      if (!s?.symbol) continue;
      stmts.push(
        this.d1
          .prepare(
            `INSERT OR REPLACE INTO news_sentiments (symbol, score, sentiment, headline_count, top_headline, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .bind(
            s.symbol,
            typeof s.score === 'number' ? s.score : 0,
            s.sentiment || 'NEUTRAL',
            s.headlineCount || 0,
            s.topHeadline || '',
            now,
          )
      );
    }

    if (stmts.length > 0) {
      await this.d1.batch(stmts);
    }
  }

  async getNewsSentiments(): Promise<StockSentiment[]> {
    const res = await this.d1
      .prepare(
        `SELECT symbol, score, sentiment, headline_count as headlineCount, top_headline as topHeadline
         FROM news_sentiments ORDER BY score DESC`
      )
      .all<StockSentiment>();
    return res.results;
  }

  async saveBotState(isRunning: boolean, config: BotConfig, mode = 'paper', startingEquity?: number): Promise<void> {
    const assetClass = config.assetClass || 'us_equity';
    const stateKey = `${mode}_${assetClass}`;

    if (typeof startingEquity === 'number') {
      await this.d1
        .prepare(
          `INSERT OR REPLACE INTO bot_state (mode, asset_class, is_running, config_json, starting_equity, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(stateKey, assetClass, isRunning ? 1 : 0, JSON.stringify(config), startingEquity, new Date().toISOString())
        .run();
    } else {
      const existing = await this.getBotState(mode, assetClass);
      await this.d1
        .prepare(
          `INSERT OR REPLACE INTO bot_state (mode, asset_class, is_running, config_json, starting_equity, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(stateKey, assetClass, isRunning ? 1 : 0, JSON.stringify(config), existing.startingEquity ?? null, new Date().toISOString())
        .run();
    }
  }

  async getBotState(
    mode = 'paper',
    assetClass = 'us_equity',
  ): Promise<{ isRunning: boolean; config: Partial<BotConfig> | null; startingEquity: number | null }> {
    try {
      const stateKey = `${mode}_${assetClass}`;
      let row = await this.d1
        .prepare(`SELECT is_running, config_json, starting_equity FROM bot_state WHERE mode = ?`)
        .bind(stateKey)
        .first<{ is_running: number; config_json: string; starting_equity?: number }>();

      if (!row) {
        row = await this.d1
          .prepare(`SELECT is_running, config_json, starting_equity FROM bot_state WHERE mode = ?`)
          .bind(mode)
          .first<{ is_running: number; config_json: string; starting_equity?: number }>();
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

  async saveRiskState(mode: string, assetClass: string, symbol: string, state: Partial<BotRiskState>): Promise<void> {
    await this.d1
      .prepare(
        `INSERT OR REPLACE INTO bot_risk_state (mode, asset_class, symbol, high_water_mark, peak_stall_count, scaled_out, last_buy_time, last_sell_time, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        mode,
        assetClass,
        symbol,
        state.highWaterMark ?? null,
        state.peakStallCount ?? 0,
        state.scaledOut ? 1 : 0,
        state.lastBuyTime ? new Date(state.lastBuyTime).toISOString() : null,
        state.lastSellTime ? new Date(state.lastSellTime).toISOString() : null,
        new Date().toISOString(),
      )
      .run();
  }

  async loadRiskState(mode: string, assetClass: string): Promise<BotRiskState[]> {
    const res = await this.d1
      .prepare(
        `SELECT symbol, high_water_mark, peak_stall_count, scaled_out, last_buy_time, last_sell_time
         FROM bot_risk_state WHERE mode = ? AND asset_class = ?`
      )
      .bind(mode, assetClass)
      .all<RiskStateRow>();

    return res.results.map((row: RiskStateRow) => ({
      symbol: row.symbol,
      highWaterMark: row.high_water_mark ?? null,
      peakStallCount: row.peak_stall_count || 0,
      scaledOut: row.scaled_out === 1,
      lastBuyTime: row.last_buy_time ? new Date(row.last_buy_time).getTime() : null,
      lastSellTime: row.last_sell_time ? new Date(row.last_sell_time).getTime() : null,
    }));
  }

  async deleteRiskState(mode: string, assetClass: string, symbol: string): Promise<void> {
    await this.d1
      .prepare('DELETE FROM bot_risk_state WHERE mode = ? AND asset_class = ? AND symbol = ?')
      .bind(mode, assetClass, symbol)
      .run();
  }

  async clearAllRiskState(mode: string): Promise<void> {
    await this.d1.prepare('DELETE FROM bot_risk_state WHERE mode = ?').bind(mode).run();
  }

  async resetSession(mode = 'paper', startingEquity: number): Promise<void> {
    await this.d1.batch([
      this.d1
        .prepare(`INSERT OR REPLACE INTO bot_state (mode, asset_class, is_running, config_json, starting_equity, updated_at) VALUES (?, 'us_equity', 0, '{}', ?, ?)`)
        .bind(mode, startingEquity, new Date().toISOString()),
      this.d1.prepare(`DELETE FROM orders WHERE mode = ?`).bind(mode),
      this.d1.prepare(`DELETE FROM bot_logs WHERE mode = ?`).bind(mode),
      this.d1.prepare(`DELETE FROM bot_risk_state WHERE mode = ?`).bind(mode),
    ]);
  }

  async saveEquitySnapshot(equity: number, pl: number, positions: { symbol: string; pl: number; mv: number }[], mode = 'paper'): Promise<void> {
    await this.d1.batch([
      this.d1
        .prepare(`INSERT INTO equity_snapshots (time, equity, pl, mode, positions_json) VALUES (?, ?, ?, ?, ?)`)
        .bind(new Date().toISOString(), equity, pl, mode, JSON.stringify(positions)),
      this.d1
        .prepare(`DELETE FROM equity_snapshots WHERE id NOT IN (SELECT id FROM equity_snapshots WHERE mode = ? ORDER BY id DESC LIMIT 300) AND mode = ?`)
        .bind(mode, mode),
    ]);
  }

  async getEquitySnapshots(
    mode = 'paper',
    limit = 300,
  ): Promise<{ time: string; equity: number; pl: number; positions: { symbol: string; pl: number; mv: number }[] }[]> {
    const res = await this.d1
      .prepare(`SELECT time, equity, pl, positions_json FROM equity_snapshots WHERE mode = ? ORDER BY id ASC LIMIT ?`)
      .bind(mode, limit)
      .all<{ time: string; equity: number; pl: number; positions_json: string }>();

    return res.results.map((row) => ({
      time: row.time,
      equity: row.equity,
      pl: row.pl,
      positions: JSON.parse(row.positions_json || '[]'),
    }));
  }
}
