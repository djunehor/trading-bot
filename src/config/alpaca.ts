import dotenv from 'dotenv';

import { Logger } from '../services/logger.js';
import type { AccountMode, AlpacaCredentials } from '../types/alpaca.js';

dotenv.config({ path: process.env.ENV_FILE || undefined });

const ENDPOINTS = {
  paper: 'https://paper-api.alpaca.markets',
  live: 'https://api.alpaca.markets',
  data: 'https://data.alpaca.markets',
} as const;

export class Config {
  private currentMode: AccountMode;

  constructor() {
    const rawMode = (process.env.ALPACA_ACCOUNT_MODE || process.env.ALPACA_MODE || 'paper').toLowerCase();
    this.currentMode = rawMode === 'live' ? 'live' : 'paper';
  }

  getAccountMode(): AccountMode {
    return this.currentMode;
  }

  setAccountMode(mode: string): AccountMode {
    const normalizedMode = String(mode).toLowerCase() as AccountMode;
    if (normalizedMode !== 'paper' && normalizedMode !== 'live') {
      throw new Error(`Invalid account mode: "${mode}". Must be "paper" or "live".`);
    }
    this.currentMode = normalizedMode;
    Logger.info(`Switched Alpaca trading mode to: ${this.currentMode.toUpperCase()}`);
    return this.currentMode;
  }

  getAlpacaCredentials(): AlpacaCredentials {
    if (this.currentMode === 'live') {
      const liveKey = process.env.ALPACA_LIVE_KEY_ID;
      const liveSecret = process.env.ALPACA_LIVE_SECRET_KEY;
      if (liveKey && liveSecret) {
        return { baseUrl: ENDPOINTS.live, dataUrl: ENDPOINTS.data, keyId: liveKey, secretKey: liveSecret, mode: 'live' };
      }
      Logger.warn('Live credentials not found (ALPACA_LIVE_KEY_ID missing). Falling back to Paper Trading credentials.');
    }

    const paperKey =
      process.env.ALPACA_PAPER_KEY_ID || process.env.ALPACA_KEY_ID || process.env.ALPACA_API_KEY || process.env.CLIENT_KEY || '';
    const paperSecret =
      process.env.ALPACA_PAPER_SECRET_KEY ||
      process.env.ALPACA_SECRET_KEY ||
      process.env.ALPACA_API_SECRET ||
      process.env.CLIENT_SECRET ||
      '';

    return { baseUrl: ENDPOINTS.paper, dataUrl: ENDPOINTS.data, keyId: paperKey, secretKey: paperSecret, mode: 'paper' };
  }
}

export const config = new Config();
