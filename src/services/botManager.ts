import { config } from '../config/alpaca.js';
import { database } from '../db/database.js';
import type { BotConfig, BotStatus, TradeSignal } from '../types/alpaca.js';

import { ACTIVE_TRADE_CASH_PCT, DEFAULT_CRYPTO_CONFIG, DEFAULT_STOCK_CONFIG, RISK_BUDGET_PER_TRADE } from './botConfig.js';
import { BotEngine } from './tradingBot.js';

let _stockBot: BotEngine | null = null;
let _cryptoBot: BotEngine | null = null;

export function getStockBot(): BotEngine {
  if (!_stockBot) {
    _stockBot = new BotEngine('us_equity', DEFAULT_STOCK_CONFIG, database);
  }
  return _stockBot;
}

export function getCryptoBot(): BotEngine {
  if (!_cryptoBot) {
    _cryptoBot = new BotEngine('crypto', DEFAULT_CRYPTO_CONFIG, database);
  }
  return _cryptoBot;
}

export const stockBot = new Proxy({} as BotEngine, {
  get(_target, prop) {
    return (getStockBot() as any)[prop];
  },
});

export const cryptoBot = new Proxy({} as BotEngine, {
  get(_target, prop) {
    return (getCryptoBot() as any)[prop];
  },
});

export class BotManager {
  static getInstance(assetClass: 'crypto' | 'us_equity' = 'us_equity'): BotEngine {
    return assetClass === 'crypto' ? getCryptoBot() : getStockBot();
  }

  static start(botConfig: Partial<BotConfig> = {}, startingEquity?: number): BotStatus {
    const targetAssetClass = botConfig.assetClass || 'us_equity';
    return BotManager.getInstance(targetAssetClass).start(botConfig, startingEquity);
  }

  static stop(assetClass: 'crypto' | 'us_equity' = 'us_equity'): BotStatus {
    return BotManager.getInstance(assetClass).stop();
  }

  static getStatus(assetClass: 'crypto' | 'us_equity' = 'us_equity'): BotStatus {
    return BotManager.getInstance(assetClass).getStatus();
  }

  static getAllStatus(): { stockBot: BotStatus; cryptoBot: BotStatus } {
    return { stockBot: stockBot.getStatus(), cryptoBot: cryptoBot.getStatus() };
  }

  static restoreStateOnBoot(): void {
    const mode = config.getAccountMode();

    const stockSaved = database.getBotState(mode, 'us_equity');
    if (stockSaved.isRunning) {
      stockBot.logEvent('Previous Stock Bot state was RUNNING. Resuming Stock Bot on boot...');
      // Strip the persisted watchlist — the curated code default (mature universe)
      // is authoritative, so stale saved watchlists can't override code changes.
      const { watchlist: _stockWatchlist, ...stockRest } = stockSaved.config || {};
      stockBot.start(stockRest);
    } else {
      stockBot.logEvent('Previous Stock Bot state was STOPPED. Remaining STOPPED on boot.');
    }

    const cryptoSaved = database.getBotState(mode, 'crypto');
    if (cryptoSaved.isRunning) {
      cryptoBot.logEvent('Previous Crypto Bot state was RUNNING. Resuming Crypto Bot on boot...');
      const { watchlist: _cryptoWatchlist, ...cryptoRest } = cryptoSaved.config || {};
      cryptoBot.start(cryptoRest);
    } else {
      cryptoBot.logEvent('Previous Crypto Bot state was STOPPED. Remaining STOPPED on boot.');
    }
  }

  static evaluateTradingStrategy(prices: number[], strategyType = 'momentum', targetSymbol = 'AAPL'): TradeSignal {
    if (!prices || prices.length < 2) {
      return { action: 'HOLD', targetSymbol, reason: 'Insufficient price data' };
    }
    const latestPrice = prices[prices.length - 1];
    const previousPrice = prices[prices.length - 2];
    const priceChangePercent = ((latestPrice - previousPrice) / previousPrice) * 100;
    if (strategyType === 'momentum') {
      if (priceChangePercent > 0.05) {
        return { action: 'BUY', targetSymbol, reason: `Upward momentum (+${priceChangePercent.toFixed(2)}%)` };
      }
      if (priceChangePercent < -0.05) {
        return { action: 'SELL', targetSymbol, reason: `Downward momentum (${priceChangePercent.toFixed(2)}%)` };
      }
    }
    return { action: 'HOLD', targetSymbol, reason: 'No trade condition met' };
  }

  static volatilitySizedQty(price: number, averageTrueRangePct: number): number {
    if (price <= 0 || averageTrueRangePct <= 0) {
      return 0;
    }
    const positionValue = RISK_BUDGET_PER_TRADE / (averageTrueRangePct / 100);
    return Math.max(1, Math.floor(positionValue / price));
  }

  static async calculatePositionSize(
    symbol: string,
    price: number,
    sentimentScore: number,
    headlines: string[],
    availableCash: number,
    fallbackQty = 0,
    assetClass: 'crypto' | 'us_equity' = 'us_equity',
  ): Promise<number> {
    if (!price || price <= 0 || !availableCash || availableCash <= 0) {
      return 0;
    }
    const maxAffordableQty = Math.floor(availableCash / price);
    if (maxAffordableQty < 1) {
      return 0;
    }
    const targetQty = Math.floor((availableCash * ACTIVE_TRADE_CASH_PCT) / price);
    const cashBasedQty = Math.max(1, targetQty);
    if (assetClass === 'crypto') {
      const targetNotional = availableCash * 0.05;
      const qty = targetNotional / price;
      const minQty = 15 / price;
      return Math.max(qty, minQty);
    }
    return Math.min(cashBasedQty, maxAffordableQty);
  }
}
