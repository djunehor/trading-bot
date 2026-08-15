import { getAccountMode, getAlpacaCredentials } from '../config/alpaca.js';
import { syncPositionsDb, saveOrderDb } from '../db/database.js';
import { getCache, setCache, delCache } from './cacheService.js';
import {
  AlpacaAccount,
  AlpacaBar,
  AlpacaOrder,
  AlpacaPosition,
  CreateOrderParams
} from '../types/alpaca.js';
import { createLogger } from './logger.js';

const log = createLogger('AlpacaService');

export async function alpacaFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const creds = getAlpacaCredentials();
  const url = `${creds.baseUrl}${endpoint}`;

  const headers: Record<string, string> = {
    'APCA-API-KEY-ID': creds.keyId,
    'APCA-API-SECRET-KEY': creds.secretKey,
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {})
  };

  try {
    const response = await fetch(url, { ...options, headers });
    const text = await response.text();

    if (!response.ok) {
      log.error(`HTTP ${response.status} ${response.statusText}: ${text}`);
      throw new Error(`API request failed with status ${response.status}: ${text}`);
    }

    return text ? JSON.parse(text) : ({ success: true } as unknown as T);
  } catch (error: any) {
    log.error(`API Exception: ${error.message}`);
    throw error;
  }
}

export async function getAccount(): Promise<AlpacaAccount> {
  const mode = getAccountMode();
  const cacheKey = `account:${mode}`;

  const cached = await getCache<AlpacaAccount>(cacheKey);
  if (cached) return cached;

  const account = await alpacaFetch<AlpacaAccount>('/v2/account');
  await setCache(cacheKey, account, 10);
  return account;
}

export async function getPositions(): Promise<AlpacaPosition[]> {
  const mode = getAccountMode();

  // Never cache positions — current_price is used for real-time risk decisions.
  const positions = await alpacaFetch<AlpacaPosition[]>('/v2/positions');

  if (Array.isArray(positions)) {
    try {
      syncPositionsDb(positions, mode);
    } catch (err: any) {
      log.warn('Non-critical database sync warning:', err.message);
    }
  }

  return positions;
}

export async function getOrders(status: string = 'all', limit: number = 50): Promise<AlpacaOrder[]> {
  const mode = getAccountMode();

  // Orders are time-sensitive (status changes frequently) — do not cache.
  const orders = await alpacaFetch<AlpacaOrder[]>(`/v2/orders?status=${status}&limit=${limit}`);

  if (Array.isArray(orders)) {
    try {
      orders.forEach(ord => saveOrderDb(ord, mode));
    } catch (err: any) {
      log.warn('Non-critical database order sync warning:', err.message);
    }
  }

  return orders;
}

async function invalidateAllCaches(): Promise<void> {
  const mode = getAccountMode();
  await delCache(`positions:${mode}`);
  await delCache(`account:${mode}`);
}

export async function createOrder(params: CreateOrderParams): Promise<AlpacaOrder> {
  const { symbol, qty, notional, side, type = 'market', time_in_force = 'gtc', limit_price = null, stop_price = null, extended_hours = false } = params;
  const mode = getAccountMode();

  log.info(`Placing order: ${side.toUpperCase()} ${notional ? `$${notional} notional` : qty} ${symbol} (${type.toUpperCase()})${extended_hours ? ' [EXTENDED HOURS]' : ''}`);

  const payload: Record<string, any> = {
    symbol: symbol.toUpperCase(),
    side: side.toLowerCase(),
    type: type.toLowerCase(),
    time_in_force: time_in_force.toLowerCase()
  };

  // Use notional (dollar amount) for crypto to meet Alpaca's $10 minimum order requirement
  if (notional !== undefined) {
    payload.notional = String(notional);
  } else {
    payload.qty = String(qty);
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

  const order = await alpacaFetch<AlpacaOrder>('/v2/orders', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  log.success(`Order placed! ID: ${order.id}, Status: ${order.status}`);

  await invalidateAllCaches();
  try {
    saveOrderDb(order, mode, params.reason);
  } catch (err: any) {
    log.warn('Non-critical database order save warning:', err.message);
  }

  return order;
}

export async function cancelOrder(orderId: string): Promise<{ success: boolean }> {
  log.info(`Canceling order ID: ${orderId}...`);
  await alpacaFetch<void>(`/v2/orders/${orderId}`, { method: 'DELETE' });
  log.info(`Order ${orderId} canceled.`);

  await invalidateAllCaches();
  return { success: true };
}

export async function closePosition(symbol: string): Promise<AlpacaOrder> {
  log.info(`Closing position for symbol: ${symbol}...`);
  const order = await alpacaFetch<AlpacaOrder>(`/v2/positions/${symbol}`, { method: 'DELETE' });
  log.info(`Position closed for ${symbol}.`);

  await invalidateAllCaches();
  return order;
}

export async function getLatestBar(symbol: string): Promise<AlpacaBar | null> {
  try {
    const creds = getAlpacaCredentials();
    const isCrypto = symbol.includes('/');

    if (isCrypto) {
      const formattedSym = symbol.toUpperCase();
      const response = await fetch(`${creds.dataUrl}/v1beta3/crypto/us/latest/bars?symbols=${encodeURIComponent(formattedSym)}`, {
        headers: {
          'APCA-API-KEY-ID': creds.keyId,
          'APCA-API-SECRET-KEY': creds.secretKey,
          'Content-Type': 'application/json'
        }
      });
      if (!response.ok) {
        log.error(`Failed to fetch bar for ${formattedSym}: HTTP ${response.status}`);
        return null;
      }
      const data = (await response.json()) as { bars?: Record<string, AlpacaBar> };
      return data.bars?.[formattedSym] || null;
    }

    const response = await fetch(`${creds.dataUrl}/v2/stocks/${symbol.toUpperCase()}/bars/latest`, {
      headers: {
        'APCA-API-KEY-ID': creds.keyId,
        'APCA-API-SECRET-KEY': creds.secretKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      log.error(`Failed to fetch bar for ${symbol}: HTTP ${response.status}`);
      return null;
    }

    const data = (await response.json()) as { bar?: AlpacaBar };
    return data.bar || null;
  } catch (error: any) {
    log.error(`Failed to fetch bar for ${symbol}: ${error.message}`);
    return null;
  }
}

// Real-time price: last trade / quote midpoint. NEVER cached — always fresh.
// Used for every trading decision (entry sizing, limit prices, exits).
export async function getCurrentPrice(symbol: string): Promise<number | null> {
  const creds = getAlpacaCredentials();
  const isCrypto = symbol.includes('/');

  try {
    if (isCrypto) {
      const formatted = symbol.toUpperCase();
      const url = `${creds.dataUrl}/v1beta3/crypto/us/latest/trades?symbols=${encodeURIComponent(formatted)}`;
      const res = await fetch(url, {
        headers: {
          'APCA-API-KEY-ID': creds.keyId,
          'APCA-API-SECRET-KEY': creds.secretKey,
          'Content-Type': 'application/json'
        }
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { trades?: Record<string, { p: number }> };
      const trade = data.trades?.[formatted];
      return trade?.p || null;
    }

    const url = `${creds.dataUrl}/v2/stocks/${symbol.toUpperCase()}/quotes/latest`;
    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': creds.keyId,
        'APCA-API-SECRET-KEY': creds.secretKey,
        'Content-Type': 'application/json'
      }
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { quote?: { bp: number; ap: number } };
    const q = data.quote;
    if (!q) return null;
    if (q.bp > 0 && q.ap > 0) return (q.bp + q.ap) / 2;
    return q.ap || q.bp || null;
  } catch (err: any) {
    log.error(`Failed to fetch real-time price for ${symbol}: ${err.message}`);
    return null;
  }
}

export async function getTopMovers(): Promise<string[]> {
  const cacheKey = 'market:top_movers';
  const cached = await getCache<string[]>(cacheKey);
  if (cached && Array.isArray(cached) && cached.length > 0) return cached;

  // Fallback universe if the screener fails — broad liquid names, not a curated watchlist.
  const fallbackUniverse = [
    'SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN', 'META',
    'GOOGL', 'AMD', 'NFLX', 'PLTR', 'QCOM', 'DIS', 'COIN', 'JPM',
    'V', 'UNH', 'BA', 'COST'
  ];

  try {
    const creds = getAlpacaCredentials();
    // Alpaca market-data screener: real top gainers + losers across the whole market.
    const response = await fetch(`${creds.dataUrl}/v1beta1/screener/stocks/movers?top=50`, {
      headers: {
        'APCA-API-KEY-ID': creds.keyId,
        'APCA-API-SECRET-KEY': creds.secretKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      log.warn(`Movers screener returned HTTP ${response.status}. Using fallback universe.`);
      return fallbackUniverse;
    }

    const data = (await response.json()) as {
      gainers?: Array<{ symbol: string; price?: number }>;
      losers?: Array<{ symbol: string; price?: number }>;
      most_actives?: Array<{ symbol: string; price?: number }>;
    };

    // Filter out penny stocks, warrants, and junk:
    // - price >= $20 (kills micro-caps & pump groups)
    // - clean ticker (letters only, 1-5 chars)
    // - no warrant suffix (ends in W)
    const movers: string[] = [];
    const seen = new Set<string>();
    const isCleanTicker = (s: string) => /^[A-Z]{1,5}$/.test(s) && !s.endsWith('W');
    for (const group of [data.gainers, data.losers, data.most_actives]) {
      for (const item of (group || [])) {
        const sym = item?.symbol || '';
        const price = item?.price ?? 0;
        if (sym && price >= 20 && isCleanTicker(sym) && !seen.has(sym)) {
          seen.add(sym);
          movers.push(sym);
        }
      }
    }

    const result = movers.length > 0 ? movers : fallbackUniverse;
    await setCache(cacheKey, result, 900); // 15-minute cache
    log.info(`Discovered ${result.length} market movers: ${result.slice(0, 5).join(', ')}...`);
    return result;
  } catch (err: any) {
    log.warn(`Failed to fetch top movers: ${err.message}. Using fallback universe.`);
    return fallbackUniverse;
  }
}

export async function getTopCryptoMovers(): Promise<string[]> {
  const cacheKey = 'crypto:top_movers';
  const cached = await getCache<string[]>(cacheKey);
  if (cached && Array.isArray(cached) && cached.length > 0) return cached;

  // All confirmed supported on Alpaca crypto bar API (verified via testCryptoBarSupport.ts)
  const defaultCryptoUniverse = [
    'BTC/USD', 'ETH/USD', 'SOL/USD', 'DOGE/USD', 'AVAX/USD',
    'LINK/USD', 'UNI/USD', 'BCH/USD', 'LTC/USD', 'DOT/USD'
  ];

  try {
    const creds = getAlpacaCredentials();
    const symbolsParam = defaultCryptoUniverse.map(s => encodeURIComponent(s)).join(',');
    const response = await fetch(`${creds.dataUrl}/v1beta3/crypto/us/snapshots?symbols=${symbolsParam}`, {
      headers: {
        'APCA-API-KEY-ID': creds.keyId,
        'APCA-API-SECRET-KEY': creds.secretKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      log.warn(`Crypto Snapshots API returned HTTP ${response.status}. Using default crypto universe.`);
      return defaultCryptoUniverse;
    }

    const data = (await response.json()) as { snapshots?: Record<string, any> };
    const snapshots = data.snapshots || {};
    const movers: Array<{ symbol: string; changePercent: number }> = [];

    for (const [sym, snap] of Object.entries(snapshots)) {
      const prevClose = snap?.prevDailyBar?.c || snap?.dailyBar?.o || 0;
      const currentPrice = snap?.latestTrade?.p || snap?.dailyBar?.c || 0;
      if (prevClose > 0 && currentPrice > 0) {
        const changePercent = ((currentPrice - prevClose) / prevClose) * 100;
        movers.push({ symbol: sym, changePercent });
      }
    }

    movers.sort((a, b) => b.changePercent - a.changePercent);
    const topSymbols = movers.map(m => m.symbol);

    const result = topSymbols.length > 0 ? topSymbols : defaultCryptoUniverse;
    await setCache(cacheKey, result, 900); // 15-minute cache
    log.info(`Discovered dynamic crypto gainers: ${result.slice(0, 5).join(', ')}`);
    return result;
  } catch (err: any) {
    log.warn(`Failed to fetch crypto top movers: ${err.message}. Using default crypto universe.`);
    return defaultCryptoUniverse;
  }
}

export async function calculateRealizedPlFromOrders(targetAssetClass?: 'us_equity' | 'crypto'): Promise<number> {
  try {
    const closedOrders = await getOrders('closed', 500);
    if (!Array.isArray(closedOrders)) return 0;

    const filtered = closedOrders.filter(o => {
      if (targetAssetClass === 'crypto') return o.asset_class === 'crypto' || o.symbol.includes('/');
      if (targetAssetClass === 'us_equity') return o.asset_class === 'us_equity' || !o.symbol.includes('/');
      return true;
    });

    const filled = filtered
      .filter(o => o.status === 'filled' && o.filled_avg_price && o.filled_at)
      .sort((a, b) => new Date(a.filled_at!).getTime() - new Date(b.filled_at!).getTime());

    const buyQueueMap: Record<string, { qty: number; price: number }[]> = {};
    let totalRealizedPl = 0;

    for (const o of filled) {
      const symbol = o.symbol;
      const qty = parseFloat(o.filled_qty || o.qty || '0');
      const price = parseFloat(o.filled_avg_price!);

      if (o.side === 'buy') {
        if (!buyQueueMap[symbol]) buyQueueMap[symbol] = [];
        buyQueueMap[symbol].push({ qty, price });
      } else if (o.side === 'sell') {
        let rem = qty;
        while (rem > 0 && buyQueueMap[symbol] && buyQueueMap[symbol].length > 0) {
          const batch = buyQueueMap[symbol][0];
          const m = Math.min(rem, batch.qty);
          const pl = m * (price - batch.price);
          totalRealizedPl += pl;
          rem -= m;
          batch.qty -= m;
          if (batch.qty <= 0) buyQueueMap[symbol].shift();
        }
      }
    }

    return totalRealizedPl;
  } catch {
    return 0;
  }
}

// Per-symbol realized P/L (FIFO) — used by the "Closed Positions" dashboard table.
export async function getRealizedPlBySymbol(): Promise<Array<{ symbol: string; realizedPl: number; closedQty: number; lastExitPrice: number }>> {
  try {
    const closedOrders = await getOrders('closed', 500);
    if (!Array.isArray(closedOrders)) return [];

    const filled = closedOrders
      .filter(o => o.status === 'filled' && o.filled_avg_price && o.filled_at)
      .sort((a, b) => new Date(a.filled_at!).getTime() - new Date(b.filled_at!).getTime());

    const buyQueueMap: Record<string, { qty: number; price: number }[]> = {};
    const resultMap: Record<string, { realizedPl: number; closedQty: number; lastExitPrice: number }> = {};

    for (const o of filled) {
      const symbol = o.symbol;
      const qty = parseFloat(o.filled_qty || o.qty || '0');
      const price = parseFloat(o.filled_avg_price!);

      if (!resultMap[symbol]) resultMap[symbol] = { realizedPl: 0, closedQty: 0, lastExitPrice: 0 };

      if (o.side === 'buy') {
        if (!buyQueueMap[symbol]) buyQueueMap[symbol] = [];
        buyQueueMap[symbol].push({ qty, price });
      } else if (o.side === 'sell') {
        let rem = qty;
        let soldQty = 0;
        while (rem > 0 && buyQueueMap[symbol] && buyQueueMap[symbol].length > 0) {
          const batch = buyQueueMap[symbol][0];
          const m = Math.min(rem, batch.qty);
          const pl = m * (price - batch.price);
          resultMap[symbol].realizedPl += pl;
          resultMap[symbol].closedQty += m;
          soldQty += m;
          rem -= m;
          batch.qty -= m;
          if (batch.qty <= 0) buyQueueMap[symbol].shift();
        }
        if (soldQty > 0) resultMap[symbol].lastExitPrice = price;
      }
    }

    return Object.entries(resultMap)
      .map(([symbol, v]) => ({ symbol, ...v }))
      .sort((a, b) => b.realizedPl - a.realizedPl);
  } catch {
    return [];
  }
}

// Today's realized P/L (FIFO, filled today only) — gates volatile-stock exposure.
export async function getTodayRealizedPl(): Promise<number> {
  try {
    const closedOrders = await getOrders('closed', 500);
    if (!Array.isArray(closedOrders)) return 0;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const filled = closedOrders
      .filter(o => o.status === 'filled' && o.filled_avg_price && o.filled_at && new Date(o.filled_at!) >= todayStart)
      .sort((a, b) => new Date(a.filled_at!).getTime() - new Date(b.filled_at!).getTime());

    const buyQueueMap: Record<string, { qty: number; price: number }[]> = {};
    let total = 0;

    for (const o of filled) {
      const symbol = o.symbol;
      const qty = parseFloat(o.filled_qty || o.qty || '0');
      const price = parseFloat(o.filled_avg_price!);

      if (o.side === 'buy') {
        if (!buyQueueMap[symbol]) buyQueueMap[symbol] = [];
        buyQueueMap[symbol].push({ qty, price });
      } else if (o.side === 'sell') {
        let rem = qty;
        while (rem > 0 && buyQueueMap[symbol] && buyQueueMap[symbol].length > 0) {
          const batch = buyQueueMap[symbol][0];
          const m = Math.min(rem, batch.qty);
          total += m * (price - batch.price);
          rem -= m;
          batch.qty -= m;
          if (batch.qty <= 0) buyQueueMap[symbol].shift();
        }
      }
    }

    return total;
  } catch {
    return 0;
  }
}
