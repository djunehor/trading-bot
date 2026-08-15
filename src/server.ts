import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAccountMode, setAccountMode, getAlpacaCredentials } from './config/alpaca.js';
import {
  getAccount,
  getPositions,
  getOrders,
  createOrder,
  cancelOrder,
  closePosition,
  calculateRealizedPlFromOrders,
  getRealizedPlBySymbol
} from './services/alpacaService.js';
import { analyzeNewsSentiment } from './services/newsService.js';
import { startBot, stopBot, getBotStatus, restoreBotStateOnBoot } from './services/tradingBot.js';
import { getOrdersDb, getBotLogsDb, getBotStateDb, saveBotStateDb, resetBotSessionDb, saveEquitySnapshot, getEquitySnapshots } from './db/database.js';
import { createLogger } from './services/logger.js';

const log = createLogger('Server');

// ── Equity History (persisted to SQLite) ─────────────────────────
let equityHistoryInterval: ReturnType<typeof setInterval> | null = null;

async function recordEquitySnapshot(): Promise<void> {
  try {
    const account = await getAccount();
    const positions = await getPositions();
    const equity = parseFloat(account.equity || '0');
    const ALL_TIME_BASELINE = 100000;
    const pl = equity - ALL_TIME_BASELINE; // all-time P/L
    const mode = getAccountMode();
    const posList = Array.isArray(positions)
      ? positions.map(p => ({
          symbol: p.symbol,
          pl: parseFloat(p.unrealized_pl || '0'),
          mv: parseFloat(p.market_value || '0')
        }))
      : [];
    saveEquitySnapshot(equity, pl, posList, mode);
  } catch { /* silent */ }
}

function startEquityTracking(): void {
  if (equityHistoryInterval) return;
  recordEquitySnapshot();
  equityHistoryInterval = setInterval(recordEquitySnapshot, 5 * 60_000);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Account & Mode Endpoints
app.get('/api/mode', (req: Request, res: Response) => {
  const mode = getAccountMode();
  const creds = getAlpacaCredentials();
  res.json({ mode, baseUrl: creds.baseUrl });
});

app.post('/api/mode', (req: Request, res: Response) => {
  const { mode } = req.body;
  if (mode !== 'paper' && mode !== 'live') {
    return res.status(400).json({ error: 'Invalid mode. Must be "paper" or "live".' });
  }
  setAccountMode(mode);
  const creds = getAlpacaCredentials();
  log.info(`Account mode changed to ${mode.toUpperCase()}`);
  res.json({ success: true, mode, baseUrl: creds.baseUrl });
});

app.get('/api/account', async (req: Request, res: Response) => {
  try {
    // Parallelize independent Alpaca API calls
    const [account, positions, closedOrders] = await Promise.all([
      getAccount(),
      getPositions(),
      getOrders('closed', 500)
    ]);

    const stockPositions = Array.isArray(positions)
      ? positions.filter(p => p.asset_class === 'us_equity')
      : [];
    const cryptoPositions = Array.isArray(positions)
      ? positions.filter(p => p.asset_class === 'crypto')
      : [];

    const stockUnrealizedPl = stockPositions.reduce((acc, p) => acc + (parseFloat(p.unrealized_pl) || 0), 0);
    const cryptoUnrealizedPl = cryptoPositions.reduce((acc, p) => acc + (parseFloat(p.unrealized_pl) || 0), 0);
    const unrealizedPl = stockUnrealizedPl + cryptoUnrealizedPl;

    const stockMarketValue = stockPositions.reduce((acc, p) => acc + (parseFloat(p.market_value) || 0), 0);
    const cryptoMarketValue = cryptoPositions.reduce((acc, p) => acc + (parseFloat(p.market_value) || 0), 0);
    const cashOnHand = parseFloat(account.cash) || 0;
    const totalPortfolio = stockMarketValue + cryptoMarketValue + cashOnHand;

    const equity = parseFloat(account.equity) || 100000;
    const mode = getAccountMode();

    // All-time baseline: $100,000 for paper accounts (Alpaca paper default)
    const ALL_TIME_BASELINE = 100000;
    const allTimePl = equity - ALL_TIME_BASELINE;

    // Daily change from Alpaca's own last_equity (yesterday's closing equity)
    const lastEquity = parseFloat(account.last_equity || '0');
    const dailyChange = equity - lastEquity;

    // Use DB for realized P/L — full order history, not truncated API window
    const calcRealizedFromOrders = (assetClass: 'us_equity' | 'crypto', orders: any[]) => {
      const filled = orders
        .filter((o: any) => {
          if (o.status !== 'filled' || !o.filled_at) return false;
          // Use filled_avg_price if available, else fall back to limit_price (DB orders may lack it)
          const price = o.filled_avg_price ?? o.limit_price;
          if (price == null) return false;
          if (assetClass === 'crypto') return o.asset_class === 'crypto' || (o.symbol && o.symbol.includes('/'));
          return o.asset_class === 'us_equity' || !(o.symbol && o.symbol.includes('/'));
        })
        .sort((a: any, b: any) => new Date(a.filled_at!).getTime() - new Date(b.filled_at!).getTime());
      const buyQueue: Record<string, { qty: number; price: number }[]> = {};
      let pl = 0;
      for (const o of filled) {
        const qty = parseFloat(o.filled_qty || o.qty || '0');
        const price = parseFloat(o.filled_avg_price ?? o.limit_price);
        if (o.side === 'buy') {
          if (!buyQueue[o.symbol]) buyQueue[o.symbol] = [];
          buyQueue[o.symbol].push({ qty, price });
        } else if (o.side === 'sell') {
          let rem = qty;
          while (rem > 0 && buyQueue[o.symbol] && buyQueue[o.symbol].length > 0) {
            const batch = buyQueue[o.symbol][0];
            const m = Math.min(rem, batch.qty);
            pl += m * (price - batch.price);
            rem -= m;
            batch.qty -= m;
            if (batch.qty <= 0) buyQueue[o.symbol].shift();
          }
        }
      }
      return pl;
    };

    // Fetch FULL order history from DB (not limited by Alpaca's 100-order window)
    const dbOrdersResult = getOrdersDb(mode, 1000, 0);
    const dbOrdersArr = Array.isArray(dbOrdersResult?.data) ? dbOrdersResult.data : [];
    const ordersArr = Array.isArray(closedOrders) ? closedOrders : [];
    // Merge: API orders win on price data (has filled_avg_price), DB fills in missing orders
    const apiOrderMap = new Map<string, any>();
    for (const o of ordersArr) {
      if (o.id) apiOrderMap.set(o.id, o);
    }
    // Start with DB orders (full history), overlay with API data for price completeness
    const mergedOrders: any[] = [];
    const seenIds = new Set<string>();
    for (const o of dbOrdersArr) {
      if (!o.id || seenIds.has(o.id)) continue;
      seenIds.add(o.id);
      const apiOrder = apiOrderMap.get(o.id);
      // Prefer API order (has filled_avg_price), fall back to DB order
      mergedOrders.push(apiOrder || o);
    }
    // Add any API orders not already in DB
    for (const o of ordersArr) {
      if (!o.id || seenIds.has(o.id)) continue;
      seenIds.add(o.id);
      mergedOrders.push(o);
    }

    const stockRealizedPl = calcRealizedFromOrders('us_equity', mergedOrders);
    const cryptoRealizedPl = calcRealizedFromOrders('crypto', mergedOrders);
    const realizedPl = stockRealizedPl + cryptoRealizedPl;

    const stockTotalPl = stockUnrealizedPl + stockRealizedPl;
    const cryptoTotalPl = cryptoUnrealizedPl + cryptoRealizedPl;

    // Today's P/L
    const todayUnrealizedPl = Array.isArray(positions)
      ? positions.reduce((acc, p) => acc + (parseFloat(p.unrealized_intraday_pl) || 0), 0)
      : 0;
    const todayStockUnrealizedPl = stockPositions.reduce((acc, p) => acc + (parseFloat(p.unrealized_intraday_pl) || 0), 0);
    const todayCryptoUnrealizedPl = cryptoPositions.reduce((acc, p) => acc + (parseFloat(p.unrealized_intraday_pl) || 0), 0);

    // Today's realized P/L from already-fetched closed orders
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    let todayRealizedPl = 0;
    let todayStockRealizedPl = 0;
    let todayCryptoRealizedPl = 0;
    const todayFilled = mergedOrders.filter(o => {
      if (o.status !== 'filled' || !o.filled_at) return false;
      return new Date(o.filled_at) >= todayStart;
    });
    if (todayFilled.length > 0) {
      todayStockRealizedPl = calcRealizedFromOrders('us_equity', todayFilled);
      todayCryptoRealizedPl = calcRealizedFromOrders('crypto', todayFilled);
      todayRealizedPl = todayStockRealizedPl + todayCryptoRealizedPl;
    }

    res.json({
      ...account,
      // ── All-time metrics (vs $100k paper baseline) ──
      all_time_pl: allTimePl.toFixed(2),
      all_time_pl_pct: ((allTimePl / ALL_TIME_BASELINE) * 100).toFixed(2),
      // ── Daily change (from Alpaca's last_equity) ──
      daily_change: dailyChange.toFixed(2),
      daily_change_pct: lastEquity > 0 ? ((dailyChange / lastEquity) * 100).toFixed(2) : '0.00',
      last_equity: lastEquity.toFixed(2),
      // ── Realized / Unrealized (from DB — approximate) ──
      unrealized_pl: unrealizedPl.toFixed(2),
      realized_pl: realizedPl.toFixed(2),
      stock_unrealized_pl: stockUnrealizedPl.toFixed(2),
      stock_realized_pl: stockRealizedPl.toFixed(2),
      stock_total_pl: stockTotalPl.toFixed(2),
      crypto_unrealized_pl: cryptoUnrealizedPl.toFixed(2),
      crypto_realized_pl: cryptoRealizedPl.toFixed(2),
      crypto_total_pl: cryptoTotalPl.toFixed(2),
      // ── Allocation ──
      stock_market_value: stockMarketValue.toFixed(2),
      crypto_market_value: cryptoMarketValue.toFixed(2),
      cash_on_hand: cashOnHand.toFixed(2),
      total_portfolio: totalPortfolio.toFixed(2),
      stock_pct: totalPortfolio > 0 ? ((stockMarketValue / totalPortfolio) * 100).toFixed(1) : '0.0',
      crypto_pct: totalPortfolio > 0 ? ((cryptoMarketValue / totalPortfolio) * 100).toFixed(1) : '0.0',
      cash_pct: totalPortfolio > 0 ? ((cashOnHand / totalPortfolio) * 100).toFixed(1) : '0.0',
      // ── Today's P/L ──
      today_unrealized_pl: todayUnrealizedPl.toFixed(2),
      today_realized_pl: todayRealizedPl.toFixed(2),
      today_stock_unrealized_pl: todayStockUnrealizedPl.toFixed(2),
      today_stock_realized_pl: todayStockRealizedPl.toFixed(2),
      today_crypto_unrealized_pl: todayCryptoUnrealizedPl.toFixed(2),
      today_crypto_realized_pl: todayCryptoRealizedPl.toFixed(2)
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/account/reset', async (req: Request, res: Response) => {
  try {
    const account = await getAccount();
    const positions = await getPositions();
    const unrealizedPl = Array.isArray(positions)
      ? positions.reduce((acc, p) => acc + (parseFloat(p.unrealized_pl) || 0), 0)
      : 0;

    const equity = parseFloat(account.equity) || 100000;
    const mode = getAccountMode();
    const newStartingEquity = equity - unrealizedPl;

    resetBotSessionDb(mode, newStartingEquity);
    res.json({ success: true, startingEquity: newStartingEquity.toFixed(2) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Position Endpoints
app.get('/api/positions', async (req: Request, res: Response) => {
  try {
    const positions = await getPositions();
    res.json(positions);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Closed positions — per-symbol realized P/L for top/worst performers table
app.get('/api/positions/closed', async (_req: Request, res: Response) => {
  try {
    const results = await getRealizedPlBySymbol();
    res.json(results);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/positions/:symbol', async (req: Request, res: Response) => {
  try {
    const symbol = req.params.symbol as string;
    const result = await closePosition(symbol);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Orders Endpoints with Paginated Query Parameters
app.get('/api/orders', async (req: Request, res: Response) => {
  try {
    const statusParam = typeof req.query.status === 'string' ? req.query.status : 'all';
    const rawPage = req.query.page;
    const rawLimit = req.query.limit;
    const rawSource = req.query.source;

    const pageStr = typeof rawPage === 'string' ? rawPage : '1';
    const limitStr = typeof rawLimit === 'string' ? rawLimit : '20';
    const sourceStr = typeof rawSource === 'string' ? rawSource : 'api';

    const page = Math.max(1, parseInt(pageStr, 10));
    const limit = Math.min(100, Math.max(1, parseInt(limitStr, 10)));
    const offset = (page - 1) * limit;

    if (sourceStr === 'db') {
      const mode = getAccountMode();
      const paginatedDb = getOrdersDb(mode, limit, offset);
      return res.json({
        orders: paginatedDb.data,
        pagination: {
          page,
          limit,
          total: paginatedDb.total,
          totalPages: Math.ceil(paginatedDb.total / limit)
        }
      });
    }

    const orders = await getOrders(statusParam, limit);
    const mode = getAccountMode();
    const dbOrders = getOrdersDb(mode, 500, 0);
    const dbReasonMap: Record<string, string> = {};
    if (dbOrders && Array.isArray(dbOrders.data)) {
      dbOrders.data.forEach((o: any) => { if (o.id && o.reason) dbReasonMap[o.id] = o.reason; });
    }

    const enrichedOrders = Array.isArray(orders) ? orders.map((o: any) => ({
      ...o,
      // Fill null qty for notional-based orders (crypto buys) so UI doesn't show null
      qty: o.qty != null ? o.qty : (o.filled_qty != null ? o.filled_qty : (o.notional || null)),
      reason: dbReasonMap[o.id] || o.reason || null
    })) : [];

    res.json({
      orders: enrichedOrders,
      pagination: { page, limit, total: enrichedOrders.length, totalPages: 1 }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orders', async (req: Request, res: Response) => {
  try {
    const { symbol, qty, side, type, limit_price, stop_price } = req.body;
    if (!symbol || !qty || !side) {
      return res.status(400).json({ error: 'Missing required order fields: symbol, qty, side.' });
    }
    const order = await createOrder({
      symbol,
      qty: Number(qty),
      side,
      type,
      limit_price: limit_price ? Number(limit_price) : undefined,
      stop_price: stop_price ? Number(stop_price) : undefined
    });
    res.json(order);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/orders/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const result = await cancelOrder(id);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Market Clock Endpoint
app.get('/api/market/clock', (req: Request, res: Response) => {
  try {
    const now = new Date();
    const nyString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const nyDate = new Date(nyString);
    const dayOfWeek = nyDate.getDay(); // 0=Sun, 6=Sat
    const hours = nyDate.getHours();
    const minutes = nyDate.getMinutes();
    const totalMinutes = hours * 60 + minutes;

    const REGULAR_OPEN = 9 * 60 + 30;  // 9:30 AM ET
    const REGULAR_CLOSE = 16 * 60;     // 4:00 PM ET
    const EXTENDED_OPEN = 20 * 60;     // 8:00 PM ET (Sunday open for 24/5)

    let marketStatus: 'regular-hours' | 'pre-market' | 'after-hours' | 'extended-weekend' | 'closed';
    let isOpen: boolean;
    let nextEvent: 'market_close' | 'market_open';
    let nextEventTime: Date;

    if (dayOfWeek === 6) {
      // Saturday: closed, next open is Sunday 8 PM ET
      marketStatus = 'closed';
      isOpen = false;
      nextEvent = 'market_open';
      nextEventTime = new Date(nyDate);
      nextEventTime.setDate(nextEventTime.getDate() + 1); // Sunday
      nextEventTime.setHours(20, 0, 0, 0);
    } else if (dayOfWeek === 0 && totalMinutes < EXTENDED_OPEN) {
      // Sunday before 8 PM: closed, next open is Sunday 8 PM ET
      marketStatus = 'closed';
      isOpen = false;
      nextEvent = 'market_open';
      nextEventTime = new Date(nyDate);
      nextEventTime.setHours(20, 0, 0, 0);
    } else if (dayOfWeek === 5 && totalMinutes >= EXTENDED_OPEN) {
      // Friday after 8 PM: closed, next open is Sunday 8 PM ET
      marketStatus = 'closed';
      isOpen = false;
      nextEvent = 'market_open';
      nextEventTime = new Date(nyDate);
      nextEventTime.setDate(nextEventTime.getDate() + 2); // Sunday
      nextEventTime.setHours(20, 0, 0, 0);
    } else if (totalMinutes < REGULAR_OPEN) {
      // Weekday pre-market (including Sun 8PM-Mon 9:29AM)
      marketStatus = 'pre-market';
      isOpen = false;
      nextEvent = 'market_open';
      nextEventTime = new Date(nyDate);
      nextEventTime.setHours(9, 30, 0, 0);
      if (dayOfWeek === 0) {
        // Sunday night — next regular open is Monday
        nextEventTime.setDate(nextEventTime.getDate() + 1);
      }
    } else if (totalMinutes >= REGULAR_OPEN && totalMinutes < REGULAR_CLOSE) {
      // Regular trading hours
      marketStatus = 'regular-hours';
      isOpen = true;
      nextEvent = 'market_close';
      nextEventTime = new Date(nyDate);
      nextEventTime.setHours(16, 0, 0, 0);
    } else {
      // After hours (4PM - 8PM weekdays, or Sun 8PM counted above as pre-market)
      marketStatus = 'after-hours';
      isOpen = false;
      nextEvent = 'market_open';
      nextEventTime = new Date(nyDate);
      nextEventTime.setDate(nextEventTime.getDate() + 1);
      // If Friday after-hours, next open is Sunday 8PM, not Saturday
      if (dayOfWeek === 5) {
        nextEventTime.setDate(nextEventTime.getDate() + 1); // Skip to Sunday
        nextEventTime.setHours(20, 0, 0, 0);
      } else if (dayOfWeek === 0) {
        // Shouldn't happen but handle Sunday after-hours gracefully
        nextEventTime.setHours(9, 30, 0, 0);
        nextEventTime.setDate(nextEventTime.getDate() + 1);
      } else {
        nextEventTime.setHours(9, 30, 0, 0);
      }
    }

    const nowMs = nyDate.getTime();
    const eventMs = nextEventTime.getTime();
    const diffMs = Math.max(0, eventMs - nowMs);
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const diffSeconds = Math.floor((diffMs % (1000 * 60)) / 1000);

    res.json({
      isOpen,
      marketStatus,
      nextEvent,
      nextEventTime: nextEventTime.toISOString(),
      countdown: { hours: diffHours, minutes: diffMinutes, seconds: diffSeconds, totalMs: diffMs },
      serverTimestamp: now.toISOString()
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Equity History Endpoint
app.get('/api/account/equity-history', (req: Request, res: Response) => {
  const mode = getAccountMode();
  const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 100), 300);
  res.json(getEquitySnapshots(mode, limit));
});

// News Sentiment Endpoint (UI dashboard — VADER only, no LLM credits burned)
app.get('/api/news/sentiment', async (req: Request, res: Response) => {
  try {
    const sentiments = await analyzeNewsSentiment(undefined, false);
    res.json(sentiments);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Bot Control Endpoints with Paginated Logs
app.get('/api/bot/status', (req: Request, res: Response) => {
  const assetClass = typeof req.query.assetClass === 'string' ? req.query.assetClass as 'us_equity' | 'crypto' : undefined;
  if (assetClass) {
    return res.json(getBotStatus(assetClass));
  }
  const stockBotStatus = getBotStatus('us_equity');
  const cryptoBotStatus = getBotStatus('crypto');
  res.json({
    stockBot: stockBotStatus,
    cryptoBot: cryptoBotStatus,
    isRunning: stockBotStatus.isRunning || cryptoBotStatus.isRunning
  });
});

app.get('/api/bot/logs', (req: Request, res: Response) => {
  const rawPage = req.query.page;
  const rawLimit = req.query.limit;
  const assetClass = typeof req.query.assetClass === 'string' ? req.query.assetClass : undefined;

  const pageStr = typeof rawPage === 'string' ? rawPage : '1';
  const limitStr = typeof rawLimit === 'string' ? rawLimit : '50';

  const page = Math.max(1, parseInt(pageStr, 10));
  const limit = Math.min(100, Math.max(1, parseInt(limitStr, 10)));
  const offset = (page - 1) * limit;
  const mode = getAccountMode();

  const paginatedLogs = getBotLogsDb(mode, limit, offset, assetClass);
  res.json({
    logs: paginatedLogs.data,
    pagination: {
      page,
      limit,
      total: paginatedLogs.total,
      totalPages: Math.ceil(paginatedLogs.total / limit)
    }
  });
});

app.post('/api/bot/start', async (req: Request, res: Response) => {
  try {
    const config = req.body || {};
    const assetClass = config.assetClass || 'us_equity';
    const account = await getAccount();
    const positions = await getPositions();
    const unrealizedPl = Array.isArray(positions)
      ? positions.reduce((acc, p) => acc + (parseFloat(p.unrealized_pl) || 0), 0)
      : 0;
    const equity = parseFloat(account.equity) || 100000;
    const newStartingEquity = equity - unrealizedPl;

    log.info(`[TradingBot] Resetting bot session baseline starting equity to $${newStartingEquity.toFixed(2)} on start (${assetClass}).`);
    const status = startBot({ ...config, assetClass }, newStartingEquity);
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/bot/stop', (req: Request, res: Response) => {
  const assetClass = req.body?.assetClass || 'us_equity';
  const status = stopBot(assetClass);
  res.json(status);
});

if (process.env.NODE_ENV !== 'test') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    log.info(`Express Trading Server listening on http://localhost:${PORT}`);
    startEquityTracking();
    // Restore previous bot state (if it was running before restart, resume running; if stopped, stay stopped)
    restoreBotStateOnBoot();
  });
}
