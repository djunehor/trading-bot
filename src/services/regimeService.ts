import { config } from '../config/alpaca.js';
import { REGIME_CACHE_MS, REGIME_SMA_PERIOD, REGIME_SYMBOL, RISK_ON_SLEEVE_ENABLED } from './botConfig.js';
import { Logger } from './logger.js';
import { MarketClock } from './marketClock.js';

export interface MarketRegime {
  /** True = broad market uptrend; the aggressive sleeve may open positions. */
  riskOn: boolean;
  symbol: string;
  /** Price compared against the SMA (live trade price, else last completed close). */
  price: number;
  /** N-session SMA of completed daily closes. */
  sma: number;
  asOf: string;
  source: 'live' | 'disabled' | 'error';
}

interface DailyClose {
  t: string;
  c: number;
}

/**
 * Decides whether the broad market is in a risk-on regime, used to gate the
 * aggressive high-beta sleeve. Fails safe: any error or missing data resolves
 * to RISK-OFF so the sleeve stays closed rather than trading blind.
 */
export class MarketRegimeService {
  private cachedRegime: MarketRegime | null = null;
  private cachedAtMs = 0;

  constructor(private readonly enabled: boolean = RISK_ON_SLEEVE_ENABLED) {}

  resetCache(): void {
    this.cachedRegime = null;
    this.cachedAtMs = 0;
  }

  async getRegime(nowMs: number = Date.now()): Promise<MarketRegime> {
    if (!this.enabled) {
      return {
        riskOn: true,
        symbol: REGIME_SYMBOL,
        price: 0,
        sma: 0,
        asOf: new Date(nowMs).toISOString(),
        source: 'disabled',
      };
    }

    if (this.cachedRegime && nowMs - this.cachedAtMs < REGIME_CACHE_MS) {
      return this.cachedRegime;
    }

    const regime = await this.computeRegime(nowMs);
    this.cachedRegime = regime;
    this.cachedAtMs = nowMs;
    return regime;
  }

  async computeRegime(nowMs: number = Date.now()): Promise<MarketRegime> {
    try {
      const bars = await this.fetchDailyCloses(REGIME_SYMBOL, REGIME_SMA_PERIOD + 5, nowMs);
      const completed = this.excludeCurrentSession(bars, nowMs);
      if (completed.length < REGIME_SMA_PERIOD) {
        throw new Error(`insufficient completed daily bars (${completed.length}/${REGIME_SMA_PERIOD})`);
      }

      const closes = completed.slice(-REGIME_SMA_PERIOD).map((bar) => bar.c);
      const sma = closes.reduce((sum, close) => sum + close, 0) / REGIME_SMA_PERIOD;
      const livePrice = await this.fetchLivePrice(REGIME_SYMBOL);
      const price = livePrice ?? completed[completed.length - 1].c;
      const riskOn = price > sma;

      Logger.info(
        `Regime: ${REGIME_SYMBOL} $${price.toFixed(2)} vs SMA${REGIME_SMA_PERIOD} $${sma.toFixed(2)} → ${riskOn ? 'RISK-ON' : 'RISK-OFF'}`,
      );
      return { riskOn, symbol: REGIME_SYMBOL, price, sma, asOf: new Date(nowMs).toISOString(), source: 'live' };
    } catch (error) {
      // Fail-safe: an unknown regime is treated as risk-off.
      Logger.warn(`Regime check failed — defaulting to RISK-OFF: ${error instanceof Error ? error.message : String(error)}`);
      return { riskOn: false, symbol: REGIME_SYMBOL, price: 0, sma: 0, asOf: new Date(nowMs).toISOString(), source: 'error' };
    }
  }

  /**
   * Drop today's incomplete session bar so a half-formed candle can't distort
   * the SMA or flip the regime intraday. Uses the timezone-safe NY clock.
   */
  private excludeCurrentSession(bars: DailyClose[], nowMs: number): DailyClose[] {
    if (bars.length === 0) {
      return bars;
    }
    const now = MarketClock.getNYParts(new Date(nowMs));
    const last = MarketClock.getNYParts(new Date(bars[bars.length - 1].t));
    const isSameDay = now.year === last.year && now.month === last.month && now.day === last.day;
    return isSameDay ? bars.slice(0, -1) : bars;
  }

  private async fetchDailyCloses(symbol: string, limit: number, nowMs: number): Promise<DailyClose[]> {
    const creds = config.getAlpacaCredentials();
    // Two non-obvious requirements on the free/IEX data plan, both learned the
    // hard way: an explicit `start` is mandatory (a bare `limit` query returns
    // only the latest bar, which would starve the SMA) and SIP must not be used.
    const start = new Date(nowMs - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const url = `${creds.dataUrl}/v2/stocks/${symbol}/bars?timeframe=1Day&start=${start}&limit=${limit}&sort=desc&feed=iex`;
    const response = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': creds.keyId,
        'APCA-API-SECRET-KEY': creds.secretKey,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(`daily bars HTTP ${response.status}`);
    }
    const data = (await response.json()) as { bars?: DailyClose[] };
    // Alpaca returns newest-first; flip to oldest-first for slicing.
    return [...(data.bars ?? [])].reverse();
  }

  private async fetchLivePrice(symbol: string): Promise<number | null> {
    try {
      const creds = config.getAlpacaCredentials();
      const url = `${creds.dataUrl}/v2/stocks/${symbol}/trades/latest`;
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
      const data = (await response.json()) as { trade?: { p: number } };
      return data.trade?.p ?? null;
    } catch {
      return null;
    }
  }
}

export const marketRegimeService = new MarketRegimeService();
