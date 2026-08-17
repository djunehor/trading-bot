import { config } from '../config/alpaca.js';
import { database, type Database, type DbOrder } from '../db/database.js';
import type { AlpacaAccount, AlpacaOrder, AlpacaPosition } from '../types/alpaca.js';

import { alpacaService, type AlpacaService } from './alpacaService.js';
import { matchSellFifo, type FifoLot } from './fifo.js';
import { Logger } from './logger.js';

interface PlOrder {
  id?: string;
  symbol: string;
  side: string;
  qty: string | number | null;
  filled_qty: string | number | null;
  filled_avg_price: string | number | null;
  limit_price: string | number | null;
  status: string;
  filled_at: string | null;
  asset_class: string;
  reason?: string | null;
}

export class PortfolioService {
  constructor(
    private readonly database: Database,
    private readonly alpaca: AlpacaService,
  ) {}

  /**
   * Merges API orders with DB orders (DB carries trade reasons), de-duplicating by id.
   */
  mergeOrders(apiOrders: AlpacaOrder[], dbOrders: DbOrder[]): PlOrder[] {
    const apiOrderMap = new Map<string, AlpacaOrder>();
    for (const order of apiOrders) {
      if (order.id) {
        apiOrderMap.set(order.id, order);
      }
    }

    const merged: PlOrder[] = [];
    const seenIds = new Set<string>();
    for (const order of dbOrders) {
      if (!order.id || seenIds.has(order.id)) {
        continue;
      }
      seenIds.add(order.id);
      merged.push(apiOrderMap.get(order.id) || order);
    }
    for (const order of apiOrders) {
      if (!order.id || seenIds.has(order.id)) {
        continue;
      }
      seenIds.add(order.id);
      merged.push(order);
    }
    return merged;
  }

  buildReasonMap(dbOrders: DbOrder[]): Record<string, string> {
    const map: Record<string, string> = {};
    for (const order of dbOrders) {
      if (order.id && order.reason) {
        map[order.id] = order.reason;
      }
    }
    return map;
  }

  sumUnrealizedPl(positions: AlpacaPosition[]): number {
    return positions.reduce((sum, position) => sum + (Number.parseFloat(position.unrealized_pl) || 0), 0);
  }

  sumMarketValue(positions: AlpacaPosition[]): number {
    return positions.reduce((sum, position) => sum + (Number.parseFloat(position.market_value) || 0), 0);
  }

  sumIntradayPl(positions: AlpacaPosition[]): number {
    return positions.reduce((sum, position) => sum + (Number.parseFloat(position.unrealized_intraday_pl) || 0), 0);
  }

  /**
   * FIFO realized P/L over an already-filtered order list for a single asset class.
   */
  calculateRealizedPl(assetClass: 'crypto' | 'us_equity', orders: PlOrder[]): number {
    const filled = orders
      .filter((order: PlOrder) => {
        if (order.status !== 'filled' || !order.filled_at) {
          return false;
        }
        const price = order.filled_avg_price ?? order.limit_price;
        if (price == null) {
          return false;
        }
        if (assetClass === 'crypto') {
          return order.asset_class === 'crypto' || order.symbol.includes('/');
        }
        return order.asset_class === 'us_equity' || !order.symbol.includes('/');
      })
      .sort((a: PlOrder, b: PlOrder) => new Date(a.filled_at ?? 0).getTime() - new Date(b.filled_at ?? 0).getTime());

    const buyQueue: Record<string, FifoLot[]> = {};
    let pl = 0;
    for (const order of filled) {
      const qty = Number.parseFloat(String(order.filled_qty ?? order.qty ?? 0));
      const price = Number.parseFloat(String(order.filled_avg_price ?? order.limit_price ?? 0));
      if (order.side === 'buy') {
        if (!buyQueue[order.symbol]) {
          buyQueue[order.symbol] = [];
        }
        buyQueue[order.symbol].push({ qty, price });
      } else if (order.side === 'sell') {
        pl += matchSellFifo(buyQueue, order.symbol, qty, price).realizedPl;
      }
    }
    return pl;
  }

  async getMergedClosedOrders(): Promise<PlOrder[]> {
    const [apiOrders, dbOrders] = await Promise.all([
      this.alpaca.getOrders('closed', 500),
      this.database.getOrders(config.getAccountMode(), 1000, 0).data,
    ]);
    return this.mergeOrders(apiOrders, dbOrders);
  }

  async getRealizedPlFromApi(targetAssetClass?: 'crypto' | 'us_equity'): Promise<number> {
    try {
      const closedOrders = await this.alpaca.getOrders('closed', 500);
      const filtered = closedOrders.filter((order) => {
        if (targetAssetClass === 'crypto') {
          return order.asset_class === 'crypto' || order.symbol.includes('/');
        }
        if (targetAssetClass === 'us_equity') {
          return order.asset_class === 'us_equity' || !order.symbol.includes('/');
        }
        return true;
      });

      const filled = filtered
        .filter((order) => order.status === 'filled' && order.filled_avg_price && order.filled_at)
        .sort((a, b) => new Date(a.filled_at!).getTime() - new Date(b.filled_at!).getTime());

      const buyQueueMap: Record<string, FifoLot[]> = {};
      let totalRealizedPl = 0;

      for (const order of filled) {
        const { symbol } = order;
        const qty = Number.parseFloat(order.filled_qty || order.qty || '0');
        const price = Number.parseFloat(order.filled_avg_price!);

        if (order.side === 'buy') {
          if (!buyQueueMap[symbol]) {
            buyQueueMap[symbol] = [];
          }
          buyQueueMap[symbol].push({ qty, price });
        } else if (order.side === 'sell') {
          totalRealizedPl += matchSellFifo(buyQueueMap, symbol, qty, price).realizedPl;
        }
      }

      return totalRealizedPl;
    } catch {
      return 0;
    }
  }

  async getRealizedPlBySymbol(): Promise<{ symbol: string; realizedPl: number; closedQty: number; lastExitPrice: number }[]> {
    try {
      const closedOrders = await this.alpaca.getOrders('closed', 500);
      const filled = closedOrders
        .filter((order) => order.status === 'filled' && order.filled_avg_price && order.filled_at)
        .sort((a, b) => new Date(a.filled_at!).getTime() - new Date(b.filled_at!).getTime());

      const buyQueueMap: Record<string, FifoLot[]> = {};
      const resultMap: Record<string, { realizedPl: number; closedQty: number; lastExitPrice: number }> = {};

      for (const order of filled) {
        const { symbol } = order;
        const qty = Number.parseFloat(order.filled_qty || order.qty || '0');
        const price = Number.parseFloat(order.filled_avg_price!);

        if (!resultMap[symbol]) {
          resultMap[symbol] = { realizedPl: 0, closedQty: 0, lastExitPrice: 0 };
        }

        if (order.side === 'buy') {
          if (!buyQueueMap[symbol]) {
            buyQueueMap[symbol] = [];
          }
          buyQueueMap[symbol].push({ qty, price });
        } else if (order.side === 'sell') {
          const matched = matchSellFifo(buyQueueMap, symbol, qty, price);
          resultMap[symbol].realizedPl += matched.realizedPl;
          resultMap[symbol].closedQty += matched.matchedQty;
          if (matched.matchedQty > 0) {
            resultMap[symbol].lastExitPrice = price;
          }
        }
      }

      return Object.entries(resultMap)
        .map(([symbol, v]) => ({ symbol, ...v }))
        .sort((a, b) => b.realizedPl - a.realizedPl);
    } catch {
      return [];
    }
  }

  /**
   * Today's realized P/L (FIFO, filled today only) — gates volatile-stock exposure.
   */
  async getTodayRealizedPl(): Promise<number> {
    try {
      const closedOrders = await this.alpaca.getOrders('closed', 500);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const filled = closedOrders
        .filter(
          (order) => order.status === 'filled' && order.filled_avg_price && order.filled_at && new Date(order.filled_at) >= todayStart,
        )
        .sort((a, b) => new Date(a.filled_at!).getTime() - new Date(b.filled_at!).getTime());

      const buyQueueMap: Record<string, FifoLot[]> = {};
      let total = 0;

      for (const order of filled) {
        const { symbol } = order;
        const qty = Number.parseFloat(order.filled_qty || order.qty || '0');
        const price = Number.parseFloat(order.filled_avg_price!);

        if (order.side === 'buy') {
          if (!buyQueueMap[symbol]) {
            buyQueueMap[symbol] = [];
          }
          buyQueueMap[symbol].push({ qty, price });
        } else if (order.side === 'sell') {
          total += matchSellFifo(buyQueueMap, symbol, qty, price).realizedPl;
        }
      }

      return total;
    } catch {
      return 0;
    }
  }

  computeStartingEquity(account: AlpacaAccount, positions: AlpacaPosition[]): number {
    return Number.parseFloat(account.equity) - this.sumUnrealizedPl(positions);
  }

  async getAccountSummary(): Promise<Record<string, unknown>> {
    const [account, positions, closedOrders, baseValue] = await Promise.all([
      this.alpaca.getAccount(),
      this.alpaca.getPositions(),
      this.alpaca.getOrders('closed', 500),
      this.alpaca.getPortfolioBaseValue(),
    ]);

    const stockPositions = positions.filter((p) => p.asset_class === 'us_equity');
    const cryptoPositions = positions.filter((p) => p.asset_class === 'crypto');

    const stockUnrealizedPl = this.sumUnrealizedPl(stockPositions);
    const cryptoUnrealizedPl = this.sumUnrealizedPl(cryptoPositions);
    const unrealizedPl = stockUnrealizedPl + cryptoUnrealizedPl;

    const stockMarketValue = this.sumMarketValue(stockPositions);
    const cryptoMarketValue = this.sumMarketValue(cryptoPositions);
    const cashOnHand = Number.parseFloat(account.cash) || 0;
    const totalPortfolio = stockMarketValue + cryptoMarketValue + cashOnHand;

    const equity = Number.parseFloat(account.equity);
    const mode = config.getAccountMode();
    const lastEquity = Number.parseFloat(account.last_equity || '0');
    const dailyChange = equity - lastEquity;
    const allTimePl = equity - baseValue;

    const mergedOrders = this.mergeOrders(closedOrders, this.database.getOrders(mode, 1000, 0).data);

    const stockRealizedPl = this.calculateRealizedPl('us_equity', mergedOrders);
    const cryptoRealizedPl = this.calculateRealizedPl('crypto', mergedOrders);
    const realizedPl = stockRealizedPl + cryptoRealizedPl;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayFilled = mergedOrders.filter((o) => o.status === 'filled' && o.filled_at && new Date(o.filled_at) >= todayStart);
    const todayStockRealizedPl = todayFilled.length > 0 ? this.calculateRealizedPl('us_equity', todayFilled) : 0;
    const todayCryptoRealizedPl = todayFilled.length > 0 ? this.calculateRealizedPl('crypto', todayFilled) : 0;

    return {
      ...account,
      all_time_pl: allTimePl.toFixed(2),
      all_time_pl_pct: baseValue > 0 ? ((allTimePl / baseValue) * 100).toFixed(2) : '0.00',
      daily_change: dailyChange.toFixed(2),
      daily_change_pct: lastEquity > 0 ? ((dailyChange / lastEquity) * 100).toFixed(2) : '0.00',
      last_equity: lastEquity.toFixed(2),
      unrealized_pl: unrealizedPl.toFixed(2),
      realized_pl: realizedPl.toFixed(2),
      stock_unrealized_pl: stockUnrealizedPl.toFixed(2),
      stock_realized_pl: stockRealizedPl.toFixed(2),
      stock_total_pl: (stockUnrealizedPl + stockRealizedPl).toFixed(2),
      crypto_unrealized_pl: cryptoUnrealizedPl.toFixed(2),
      crypto_realized_pl: cryptoRealizedPl.toFixed(2),
      crypto_total_pl: (cryptoUnrealizedPl + cryptoRealizedPl).toFixed(2),
      stock_market_value: stockMarketValue.toFixed(2),
      crypto_market_value: cryptoMarketValue.toFixed(2),
      cash_on_hand: cashOnHand.toFixed(2),
      total_portfolio: totalPortfolio.toFixed(2),
      stock_pct: totalPortfolio > 0 ? ((stockMarketValue / totalPortfolio) * 100).toFixed(1) : '0.0',
      crypto_pct: totalPortfolio > 0 ? ((cryptoMarketValue / totalPortfolio) * 100).toFixed(1) : '0.0',
      cash_pct: totalPortfolio > 0 ? ((cashOnHand / totalPortfolio) * 100).toFixed(1) : '0.0',
      today_unrealized_pl: this.sumIntradayPl(positions).toFixed(2),
      today_realized_pl: (todayStockRealizedPl + todayCryptoRealizedPl).toFixed(2),
      today_stock_unrealized_pl: this.sumIntradayPl(stockPositions).toFixed(2),
      today_stock_realized_pl: todayStockRealizedPl.toFixed(2),
      today_crypto_unrealized_pl: this.sumIntradayPl(cryptoPositions).toFixed(2),
      today_crypto_realized_pl: todayCryptoRealizedPl.toFixed(2),
    };
  }

  async recordEquitySnapshot(): Promise<void> {
    try {
      const account = await this.alpaca.getAccount();
      const positions = await this.alpaca.getPositions();
      const equity = Number.parseFloat(account.equity);
      const baseValue = await this.alpaca.getPortfolioBaseValue();
      const pl = equity - baseValue;
      const posList = positions.map((p) => ({
        symbol: p.symbol,
        pl: Number.parseFloat(p.unrealized_pl || '0'),
        mv: Number.parseFloat(p.market_value || '0'),
      }));
      this.database.saveEquitySnapshot(equity, pl, posList, config.getAccountMode());
    } catch {
      Logger.warn('Failed to record equity snapshot.');
    }
  }
}

export const portfolioService = new PortfolioService(database, alpacaService);
