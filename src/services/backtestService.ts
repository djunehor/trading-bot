import { DEFAULT_STOCK_CONFIG } from './botConfig.js';
import { TechnicalService, type Bar } from './technicalService.js';

export interface BacktestTrade {
  symbol: string;
  entry: number;
  exit: number;
  qty: number;
  pnl: number;
  reason: string;
  entryTime: string;
  exitTime: string;
}

export interface BacktestResult {
  symbol: string;
  trades: BacktestTrade[];
  finalEquity: number;
  maxDrawdown: number;
}

export interface BacktestSummary {
  symbols: string[];
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  totalPnl: number;
  avgWin: number;
  avgLoss: number;
  finalEquity: number;
  maxDrawdown: number;
  tradesList: BacktestTrade[];
  results: BacktestResult[];
}

const STOP_LOSS_PCT = DEFAULT_STOCK_CONFIG.stopLossPercent;
const TAKE_PROFIT_PCT = DEFAULT_STOCK_CONFIG.takeProfitPercent;
const TRAILING_STOP_PCT = DEFAULT_STOCK_CONFIG.trailingStopPercent ?? 1.5;
const POSITION_SIZE_PCT = 0.05;
const MIN_CONFIDENCE = 0.55;
const CONTEXT_BARS = 60;
const STARTING_CASH = 100_000;
const DATA_URL = 'https://data.alpaca.markets';

// Normalize a date-only flag ("2026-08-19") to a full ISO datetime so Alpaca treats it
// as a past day boundary rather than "up to now" (which requires real-time SIP data).
export function toIsoDay(value: string): string {
  return value.includes('T') ? value : `${value}T00:00:00Z`;
}

async function fetchBars(symbol: string, timeframe: string, start: string, end: string, limit: number): Promise<Bar[]> {
  const key = process.env.ALPACA_PAPER_KEY_ID || '';
  const secret = process.env.ALPACA_PAPER_SECRET_KEY || '';
  const all: Bar[] = [];
  let token: string | null = null;
  let pages = 0;

  do {
    const page = token ? `&page_token=${token}` : '';
    const url = `${DATA_URL}/v2/stocks/${symbol}/bars?timeframe=${timeframe}&start=${start}&end=${end}&limit=${limit}&adjustment=raw&sort=asc${page}`;
    const response = await fetch(url, {
      headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`${symbol} ${timeframe}: HTTP ${response.status}`);
    }
    const data = (await response.json()) as { bars?: Bar[]; next_page_token?: string | null };
    all.push(...(data.bars || []));
    token = data.next_page_token || null;
    pages++;
  } while (token && pages < 10);

  return all;
}

function computeMaxDrawdown(equityCurve: number[]): number {
  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const equity of equityCurve) {
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  return maxDrawdown;
}

async function backtestSymbol(symbol: string, start: string, end: string): Promise<BacktestResult> {
  const technicalService = new TechnicalService();

  // Warmup: 5-min signals need ~60 bars of history; daily signals need up to a year.
  const barsStart = new Date(new Date(start).getTime() - 10 * 86_400_000).toISOString();
  const dailyStart = new Date(new Date(start).getTime() - 400 * 86_400_000).toISOString();

  const bars = await fetchBars(symbol, '5Min', barsStart, end, 10_000);
  const dailyBars = await fetchBars(symbol, '1Day', dailyStart, end, 500);

  let cash = STARTING_CASH;
  let position: { qty: number; entryPrice: number; peakPrice: number; entryTime: string } | null = null;
  const trades: BacktestTrade[] = [];
  const equityCurve: number[] = [];

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const price = bar.c;

    if (i >= CONTEXT_BARS - 1) {
      const window = bars.slice(i - CONTEXT_BARS + 1, i + 1);
      const barTime = new Date(bar.t).getTime();
      const dailyWindow = dailyBars.filter((d) => new Date(d.t).getTime() <= barTime);
      const context = technicalService.buildContextFromBars(symbol, window, dailyWindow, price);

      if (context) {
        const signal = technicalService.evaluate(context);

        if (!position && signal.action === 'BUY' && signal.confidence >= MIN_CONFIDENCE) {
          const qty = Math.floor((cash * POSITION_SIZE_PCT) / price);
          if (qty > 0) {
            cash -= qty * price;
            position = { qty, entryPrice: price, peakPrice: bar.h, entryTime: bar.t };
          }
        } else if (position && signal.action === 'SELL') {
          const pnl = (price - position.entryPrice) * position.qty;
          cash += position.qty * price;
          trades.push({ symbol, entry: position.entryPrice, exit: price, qty: position.qty, pnl, reason: signal.reason, entryTime: position.entryTime, exitTime: bar.t });
          position = null;
        }
      }
    }

    if (position) {
      position.peakPrice = Math.max(position.peakPrice, bar.h);
      const gainPct = ((price - position.entryPrice) / position.entryPrice) * 100;
      const dropPct = ((position.peakPrice - price) / position.peakPrice) * 100;

      let reason: string | null = null;
      if (gainPct <= -STOP_LOSS_PCT) {
        reason = 'stop-loss';
      } else if (gainPct >= TAKE_PROFIT_PCT) {
        reason = 'take-profit';
      } else if (gainPct > 0 && dropPct >= TRAILING_STOP_PCT) {
        reason = 'trailing-stop';
      }

      if (reason) {
        const pnl = (price - position.entryPrice) * position.qty;
        cash += position.qty * price;
        trades.push({ symbol, entry: position.entryPrice, exit: price, qty: position.qty, pnl, reason, entryTime: position.entryTime, exitTime: bar.t });
        position = null;
      }
    }

    equityCurve.push(cash + (position ? position.qty * price : 0));
  }

  if (position) {
    const lastPrice = bars[bars.length - 1].c;
    const pnl = (lastPrice - position.entryPrice) * position.qty;
    cash += position.qty * lastPrice;
    trades.push({ symbol, entry: position.entryPrice, exit: lastPrice, qty: position.qty, pnl, reason: 'end-of-test', entryTime: position.entryTime, exitTime: bars[bars.length - 1].t });
  }

  return { symbol, trades, finalEquity: cash, maxDrawdown: computeMaxDrawdown(equityCurve) };
}

export async function runBacktest(symbols: string[], start: string, end: string): Promise<BacktestResult[]> {
  const results: BacktestResult[] = [];
  for (const symbol of symbols) {
    results.push(await backtestSymbol(symbol, start, end));
  }
  return results;
}

export function summarize(results: BacktestResult[]): BacktestSummary {
  const trades = results.flatMap((r) => r.trades);
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = losses.reduce((sum, t) => sum + t.pnl, 0);

  return {
    symbols: results.map((r) => r.symbol),
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    grossProfit,
    grossLoss,
    totalPnl,
    avgWin: wins.length ? grossProfit / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    finalEquity: STARTING_CASH + totalPnl,
    maxDrawdown: results.reduce((max, r) => Math.max(max, r.maxDrawdown), 0),
    tradesList: trades,
    results,
  };
}
