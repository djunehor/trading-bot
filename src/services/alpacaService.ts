import { config } from '../config/alpaca.js';
import { database, type Database } from '../db/database.js';
import type { AlpacaAccount, AlpacaBar, AlpacaOrder, AlpacaPosition, CreateOrderParameters } from '../types/alpaca.js';

import { cacheService } from './cacheService.js';
import { Logger } from './logger.js';

interface CryptoSymbolSnapshot {
  prevDailyBar?: { c: number };
  dailyBar?: { o: number; c: number };
  latestTrade?: { p: number };
}

export class AlpacaService {
  constructor(private readonly database: Database) {}

  async fetch<T>(endpoint: string, options: RequestInit = {}, targetAccount: string = 'clean'): Promise<T> {
    const creds = config.getAlpacaCredentials(targetAccount);
    const url = `${creds.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      'APCA-API-KEY-ID': creds.keyId,
      'APCA-API-SECRET-KEY': creds.secretKey,
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    try {
      const response = await fetch(url, { ...options, headers });
      const text = await response.text();

      if (!response.ok) {
        Logger.error(`HTTP ${response.status} ${response.statusText}: ${text}`);
        throw new Error(`API request failed with status ${response.status}: ${text}`);
      }

      return text ? JSON.parse(text) : ({ success: true } as unknown as T);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Logger.error(`API Exception: ${message}`);
      throw error;
    }
  }

  async getAccount(targetAccount = 'clean'): Promise<AlpacaAccount> {
    const mode = config.getAccountMode();
    const cacheKey = `account:${mode}:${targetAccount}`;

    const cached = await cacheService.get<AlpacaAccount>(cacheKey);
    if (cached) {
      return cached;
    }

    const account = await this.fetch<AlpacaAccount>('/v2/account', {}, targetAccount);
    await cacheService.set(cacheKey, account, 10);
    return account;
  }

  /**
   * Alpaca's P/L basis (base_value) — the starting equity used for all-time profit/loss.
   */
  async getPortfolioBaseValue(targetAccount = 'clean'): Promise<number> {
    const data = await this.fetch<{ base_value: number }>(
      '/v2/account/portfolio/history?period=all&timeframe=1D&pnl_reset=no_reset',
      {},
      targetAccount,
    );
    return data.base_value;
  }

  async getPositions(targetAccount = 'clean'): Promise<AlpacaPosition[]> {
    const mode = config.getAccountMode();
    const dbMode = `${mode}_${targetAccount}`;

    // Never cache positions — current_price is used for real-time risk decisions.
    const body = await this.fetch<unknown>('/v2/positions', {}, targetAccount);
    const positions = Array.isArray(body) ? (body as AlpacaPosition[]) : [];

    try {
      this.database.syncPositions(positions, dbMode);
    } catch (error) {
      Logger.warn('Non-critical database sync warning:', error instanceof Error ? error.message : String(error));
    }

    return positions;
  }

  async getOrders(status = 'all', limit = 50, targetAccount = 'clean'): Promise<AlpacaOrder[]> {
    const mode = config.getAccountMode();
    const dbMode = `${mode}_${targetAccount}`;

    // Orders are time-sensitive (status changes frequently) — do not cache.
    const body = await this.fetch<unknown>(`/v2/orders?status=${status}&limit=${limit}`, {}, targetAccount);
    const orders = Array.isArray(body) ? (body as AlpacaOrder[]) : [];

    try {
      for (const order of orders) {
        this.database.saveOrder(order, dbMode);
      }
    } catch (error) {
      Logger.warn('Non-critical database order sync warning:', error instanceof Error ? error.message : String(error));
    }

    return orders;
  }

  async createOrder(parameters: CreateOrderParameters, targetAccount = 'clean'): Promise<AlpacaOrder> {
    const {
      symbol,
      qty,
      notional,
      side,
      type = 'market',
      time_in_force = 'gtc',
      limit_price = null,
      stop_price = null,
      extended_hours = false,
    } = parameters;
    const mode = config.getAccountMode();
    const dbMode = `${mode}_${targetAccount}`;

    Logger.info(
      `[${targetAccount.toUpperCase()}] Placing order: ${side.toUpperCase()} ${notional ? `$${notional} notional` : qty} ${symbol} (${type.toUpperCase()})${extended_hours ? ' [EXTENDED HOURS]' : ''}`,
    );

    const payload: Record<string, unknown> = {
      symbol: symbol.toUpperCase(),
      side: side.toLowerCase(),
      type: type.toLowerCase(),
      time_in_force: time_in_force.toLowerCase(),
    };

    if (notional === undefined) {
      payload.qty = String(qty);
    } else {
      payload.notional = String(notional);
    }

    if (extended_hours) {
      payload.extended_hours = true;
    }

    if (type.toLowerCase() === 'limit' && limit_price) {
      payload.limit_price = String(limit_price);
    }
    if (type.toLowerCase() === 'stop' && stop_price) {
      payload.stop_price = String(stop_price);
    }

    const order = await this.fetch<AlpacaOrder>(
      '/v2/orders',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      targetAccount,
    );

    Logger.success(`[${targetAccount.toUpperCase()}] Order placed! ID: ${order.id}, Status: ${order.status}`);

    await this.invalidateAllCaches();
    try {
      this.database.saveOrder(order, dbMode, parameters.reason);
    } catch (error) {
      Logger.warn('Non-critical database order save warning:', error instanceof Error ? error.message : String(error));
    }

    return order;
  }

  async cancelOrder(orderId: string, targetAccount = 'clean'): Promise<{ id: string; success: boolean }> {
    Logger.info(`[${targetAccount.toUpperCase()}] Canceling order ID: ${orderId}...`);
    await this.fetch<void>(`/v2/orders/${orderId}`, { method: 'DELETE' }, targetAccount);
    Logger.info(`[${targetAccount.toUpperCase()}] Order ${orderId} canceled.`);

    await this.invalidateAllCaches();
    return { id: orderId, success: true };
  }

  async closePosition(symbol: string, targetAccount = 'clean'): Promise<AlpacaOrder> {
    Logger.info(`[${targetAccount.toUpperCase()}] Closing position for symbol: ${symbol}...`);
    const order = await this.fetch<AlpacaOrder>(`/v2/positions/${symbol}`, { method: 'DELETE' }, targetAccount);
    Logger.info(`[${targetAccount.toUpperCase()}] Position closed for ${symbol}.`);

    await this.invalidateAllCaches();
    return order;
  }

  async getLatestBar(symbol: string): Promise<AlpacaBar | null> {
    try {
      const creds = config.getAlpacaCredentials();
      if (symbol.includes('/')) {
        return await this.fetchLatestCryptoBar(symbol.toUpperCase());
      }

      const response = await fetch(`${creds.dataUrl}/v2/stocks/${symbol.toUpperCase()}/bars/latest`, {
        headers: {
          'APCA-API-KEY-ID': creds.keyId,
          'APCA-API-SECRET-KEY': creds.secretKey,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        Logger.error(`Failed to fetch bar for ${symbol}: HTTP ${response.status}`);
        return null;
      }

      const data = (await response.json()) as { bar?: AlpacaBar };
      return data.bar || null;
    } catch (error) {
      Logger.error(`Failed to fetch bar for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Real-time price: last trade / quote midpoint. Never cached — used for every trading decision.
   */
  async getCurrentPrice(symbol: string): Promise<number | null> {
    const creds = config.getAlpacaCredentials();

    try {
      if (symbol.includes('/')) {
        return await this.fetchCryptoPrice(symbol.toUpperCase());
      }

      const url = `${creds.dataUrl}/v2/stocks/${symbol.toUpperCase()}/quotes/latest`;
      const response = await fetch(url, {
        headers: {
          'APCA-API-KEY-ID': creds.keyId,
          'APCA-API-SECRET-KEY': creds.secretKey,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        return null;
      }
      const data = (await response.json()) as { quote?: { bp: number; ap: number } };
      const quote = data.quote;
      if (!quote) {
        return null;
      }
      if (quote.bp > 0 && quote.ap > 0) {
        return (quote.bp + quote.ap) / 2;
      }
      return quote.ap || quote.bp || null;
    } catch (error) {
      Logger.error(`Failed to fetch real-time price for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private async fetchLatestCryptoBar(formattedSym: string): Promise<AlpacaBar | null> {
    const creds = config.getAlpacaCredentials();
    const response = await fetch(`${creds.dataUrl}/v1beta3/crypto/us/latest/bars?symbols=${encodeURIComponent(formattedSym)}`, {
      headers: {
        'APCA-API-KEY-ID': creds.keyId,
        'APCA-API-SECRET-KEY': creds.secretKey,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      Logger.error(`Failed to fetch bar for ${formattedSym}: HTTP ${response.status}`);
      return null;
    }
    const data = (await response.json()) as { bars?: Record<string, AlpacaBar> };
    return data.bars?.[formattedSym] || null;
  }

  private async fetchCryptoPrice(formatted: string): Promise<number | null> {
    const creds = config.getAlpacaCredentials();
    const url = `${creds.dataUrl}/v1beta3/crypto/us/latest/trades?symbols=${encodeURIComponent(formatted)}`;
    const response = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': creds.keyId,
        'APCA-API-SECRET-KEY': creds.secretKey,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as { trades?: Record<string, { p: number }> };
    return data.trades?.[formatted]?.p || null;
  }

  async getTopMovers(): Promise<string[]> {
    const cacheKey = 'market:top_movers';
    const cached = await cacheService.get<string[]>(cacheKey);
    if (cached?.length) {
      return cached;
    }

    // Fallback universe if the screener fails — broad liquid names, not a curated watchlist.
    const fallbackUniverse = [
      'SPY',
      'QQQ',
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
      'QCOM',
      'DIS',
      'COIN',
      'JPM',
      'V',
      'UNH',
      'BA',
      'COST',
    ];

    try {
      const creds = config.getAlpacaCredentials();
      // Alpaca market-data screener: real top gainers + losers across the whole market.
      const response = await fetch(`${creds.dataUrl}/v1beta1/screener/stocks/movers?top=50`, {
        headers: {
          'APCA-API-KEY-ID': creds.keyId,
          'APCA-API-SECRET-KEY': creds.secretKey,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        Logger.warn(`Movers screener returned HTTP ${response.status}. Using fallback universe.`);
        return fallbackUniverse;
      }

      const data = (await response.json()) as {
        gainers?: { symbol: string; price?: number }[];
        losers?: { symbol: string; price?: number }[];
        most_actives?: { symbol: string; price?: number }[];
      };

      // Filter out penny stocks, warrants, and junk:
      // - price >= $50 (kills micro-caps & pump groups)
      // - clean ticker (letters only, 1-5 chars)
      // - no warrant suffix (ends in W)
      const movers: string[] = [];
      const seen = new Set<string>();
      const isCleanTicker = (s: string) => /^[A-Z]{1,5}$/.test(s) && !s.endsWith('W');
      for (const group of [data.gainers, data.losers, data.most_actives]) {
        for (const item of group || []) {
          const sym = item?.symbol || '';
          const price = item?.price ?? 0;
          if (sym && price >= 50 && isCleanTicker(sym) && !seen.has(sym)) {
            seen.add(sym);
            movers.push(sym);
          }
        }
      }

      const result = movers.length > 0 ? movers : fallbackUniverse;
      await cacheService.set(cacheKey, result, 900); // 15-minute cache
      Logger.info(`Discovered ${result.length} market movers: ${result.slice(0, 5).join(', ')}...`);
      return result;
    } catch (error) {
      Logger.warn(`Failed to fetch top movers: ${error instanceof Error ? error.message : String(error)}. Using fallback universe.`);
      return fallbackUniverse;
    }
  }

  async getTopCryptoMovers(): Promise<string[]> {
    const cacheKey = 'crypto:top_movers';
    const cached = await cacheService.get<string[]>(cacheKey);
    if (cached?.length) {
      return cached;
    }

    // All confirmed supported on Alpaca crypto bar API
    const defaultCryptoUniverse = [
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

    try {
      const creds = config.getAlpacaCredentials();
      const symbolsParameter = defaultCryptoUniverse.map((s) => encodeURIComponent(s)).join(',');
      const response = await fetch(`${creds.dataUrl}/v1beta3/crypto/us/snapshots?symbols=${symbolsParameter}`, {
        headers: {
          'APCA-API-KEY-ID': creds.keyId,
          'APCA-API-SECRET-KEY': creds.secretKey,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        Logger.warn(`Crypto Snapshots API returned HTTP ${response.status}. Using default crypto universe.`);
        return defaultCryptoUniverse;
      }

      const data = (await response.json()) as { snapshots?: Record<string, CryptoSymbolSnapshot> };
      const snapshots = data.snapshots || {};
      const movers: { symbol: string; changePercent: number }[] = [];

      for (const [sym, snap] of Object.entries(snapshots)) {
        const previousClose = snap?.prevDailyBar?.c || snap?.dailyBar?.o || 0;
        const currentPrice = snap?.latestTrade?.p || snap?.dailyBar?.c || 0;
        if (previousClose > 0 && currentPrice > 0) {
          const changePercent = ((currentPrice - previousClose) / previousClose) * 100;
          movers.push({ symbol: sym, changePercent });
        }
      }

      movers.sort((a, b) => b.changePercent - a.changePercent);
      const topSymbols = movers.map((m) => m.symbol);

      const result = topSymbols.length > 0 ? topSymbols : defaultCryptoUniverse;
      await cacheService.set(cacheKey, result, 900); // 15-minute cache
      Logger.info(`Discovered dynamic crypto gainers: ${result.slice(0, 5).join(', ')}`);
      return result;
    } catch (error) {
      Logger.warn(
        `Failed to fetch crypto top movers: ${error instanceof Error ? error.message : String(error)}. Using default crypto universe.`,
      );
      return defaultCryptoUniverse;
    }
  }

  public async invalidateAllCaches(): Promise<void> {
    const mode = config.getAccountMode();
    await cacheService.remove(`positions:${mode}`);
    await cacheService.remove(`account:${mode}`);
  }
}

export const alpacaService = new AlpacaService(database);
