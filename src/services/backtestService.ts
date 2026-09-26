import { DEFAULT_STOCK_CONFIG } from './botConfig.js';
import { TechnicalService, type Bar } from './technicalService.js';

export interface BacktestTrade {
  symbol: string;
  entry: number;
  exit: number;
  qty: number;
  pnl: number;
  pnlPct: number;
  reason: string;
  entryTime: string;
  exitTime: string;
}

export interface BacktestResult {
  symbol: string;
  trades: BacktestTrade[];
  initialCash: number;
  finalEquity: number;
  maxDrawdown: number;
  buyAndHoldReturnPct: number;
  buyAndHoldFinalEquity: number;
  startPrice: number;
  endPrice: number;
}

export interface BacktestSummary {
  symbols: string[];
  initialCapital: number;
  finalEquity: number;
  totalPnl: number;
  returnPct: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  avgWin: number;
  avgLoss: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  buyAndHoldReturnPct: number;
  buyAndHoldFinalEquity: number;
  tradesList: BacktestTrade[];
  results: BacktestResult[];
}

export interface BacktestOptions {
  startingCash?: number;
  positionSizePct?: number;
}

const STOP_LOSS_PCT = DEFAULT_STOCK_CONFIG.stopLossPercent;
const TAKE_PROFIT_PCT = DEFAULT_STOCK_CONFIG.takeProfitPercent;
const TRAILING_STOP_PCT = DEFAULT_STOCK_CONFIG.trailingStopPercent ?? 1.5;
export const DEFAULT_POSITION_SIZE_PCT = 1.0;
const MIN_CONFIDENCE = 0.55;
const CONTEXT_BARS = 60;
export const DEFAULT_STARTING_CASH = 100_000;
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

async function backtestSymbol(
  symbol: string,
  start: string,
  end: string,
  initialCash = DEFAULT_STARTING_CASH,
  positionSizePct = DEFAULT_POSITION_SIZE_PCT
): Promise<BacktestResult> {
  const technicalService = new TechnicalService();

  // Warmup: 5-min signals need ~60 bars of history; daily signals need up to a year.
  const barsStart = new Date(new Date(start).getTime() - 10 * 86_400_000).toISOString();
  const dailyStart = new Date(new Date(start).getTime() - 400 * 86_400_000).toISOString();

  const bars = await fetchBars(symbol, '5Min', barsStart, end, 10_000);
  const dailyBars = await fetchBars(symbol, '1Day', dailyStart, end, 500);

  // Buy and hold benchmark calculation based on price range in test window
  const testBars = bars.filter((b) => b.t >= start && b.t <= end);
  const startPrice = testBars.length > 0 ? testBars[0].o : (bars.length > 0 ? bars[0].o : 0);
  const endPrice = testBars.length > 0 ? testBars[testBars.length - 1].c : (bars.length > 0 ? bars[bars.length - 1].c : 0);
  const buyAndHoldReturnPct = startPrice > 0 ? ((endPrice - startPrice) / startPrice) * 100 : 0;
  const buyAndHoldFinalEquity = initialCash * (1 + buyAndHoldReturnPct / 100);

  let cash = initialCash;
  let position: { qty: number; entryPrice: number; peakPrice: number; entryTime: string } | null = null;
  const trades: BacktestTrade[] = [];
  const equityCurve: number[] = [initialCash];

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

        if (!position && signal.action === 'BUY' && signal.confidence >= MIN_CONFIDENCE && bar.t >= start) {
          const qty = Math.floor((cash * positionSizePct) / price);
          if (qty > 0) {
            cash -= qty * price;
            position = { qty, entryPrice: price, peakPrice: bar.h, entryTime: bar.t };
          }
        } else if (position && signal.action === 'SELL') {
          const pnl = (price - position.entryPrice) * position.qty;
          const pnlPct = position.entryPrice > 0 ? ((price - position.entryPrice) / position.entryPrice) * 100 : 0;
          cash += position.qty * price;
          trades.push({
            symbol,
            entry: position.entryPrice,
            exit: price,
            qty: position.qty,
            pnl,
            pnlPct,
            reason: signal.reason,
            entryTime: position.entryTime,
            exitTime: bar.t,
          });
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
        const pnlPct = position.entryPrice > 0 ? ((price - position.entryPrice) / position.entryPrice) * 100 : 0;
        cash += position.qty * price;
        trades.push({
          symbol,
          entry: position.entryPrice,
          exit: price,
          qty: position.qty,
          pnl,
          pnlPct,
          reason,
          entryTime: position.entryTime,
          exitTime: bar.t,
        });
        position = null;
      }
    }

    equityCurve.push(cash + (position ? position.qty * price : 0));
  }

  if (position) {
    const lastPrice = bars[bars.length - 1].c;
    const pnl = (lastPrice - position.entryPrice) * position.qty;
    const pnlPct = position.entryPrice > 0 ? ((lastPrice - position.entryPrice) / position.entryPrice) * 100 : 0;
    cash += position.qty * lastPrice;
    trades.push({
      symbol,
      entry: position.entryPrice,
      exit: lastPrice,
      qty: position.qty,
      pnl,
      pnlPct,
      reason: 'end-of-test',
      entryTime: position.entryTime,
      exitTime: bars[bars.length - 1].t,
    });
  }

  return {
    symbol,
    trades,
    initialCash,
    finalEquity: cash,
    maxDrawdown: computeMaxDrawdown(equityCurve),
    buyAndHoldReturnPct,
    buyAndHoldFinalEquity,
    startPrice,
    endPrice,
  };
}

export async function runBacktest(
  symbols: string[],
  start: string,
  end: string,
  options?: BacktestOptions
): Promise<BacktestResult[]> {
  const startingCash = options?.startingCash && options.startingCash > 0 ? options.startingCash : DEFAULT_STARTING_CASH;
  const positionSizePct = options?.positionSizePct && options.positionSizePct > 0 && options.positionSizePct <= 1
    ? options.positionSizePct
    : DEFAULT_POSITION_SIZE_PCT;

  const cashPerSymbol = symbols.length > 0 ? startingCash / symbols.length : startingCash;
  const results: BacktestResult[] = [];
  for (const symbol of symbols) {
    results.push(await backtestSymbol(symbol, start, end, cashPerSymbol, positionSizePct));
  }
  return results;
}

export function summarize(results: BacktestResult[], customInitialCapital?: number): BacktestSummary {
  const trades = results.flatMap((r) => r.trades);
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = losses.reduce((sum, t) => sum + t.pnl, 0);

  const initialCapital = customInitialCapital ?? (
    results.length > 0
      ? results.reduce((sum, r) => sum + (r.initialCash ?? DEFAULT_STARTING_CASH), 0)
      : DEFAULT_STARTING_CASH
  );

  const finalEquity = Number((initialCapital + totalPnl).toFixed(2));
  const returnPct = initialCapital > 0 ? Number(((totalPnl / initialCapital) * 100).toFixed(4)) : 0;
  const maxDrawdown = Number(results.reduce((max, r) => Math.max(max, r.maxDrawdown), 0).toFixed(2));
  const maxDrawdownPct = initialCapital > 0 ? Number(((maxDrawdown / initialCapital) * 100).toFixed(4)) : 0;

  const validBnH = results.filter((r) => typeof r.buyAndHoldReturnPct === 'number' && !Number.isNaN(r.buyAndHoldReturnPct));
  const buyAndHoldReturnPct = validBnH.length > 0
    ? Number((validBnH.reduce((sum, r) => sum + r.buyAndHoldReturnPct, 0) / validBnH.length).toFixed(4))
    : 0;
  const buyAndHoldFinalEquity = Number((initialCapital * (1 + buyAndHoldReturnPct / 100)).toFixed(2));

  return {
    symbols: results.map((r) => r.symbol),
    initialCapital,
    finalEquity,
    totalPnl,
    returnPct,
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    grossProfit,
    grossLoss,
    avgWin: wins.length ? grossProfit / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    maxDrawdown,
    maxDrawdownPct,
    buyAndHoldReturnPct,
    buyAndHoldFinalEquity,
    tradesList: trades,
    results,
  };
}
