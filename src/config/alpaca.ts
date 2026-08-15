import dotenv from 'dotenv';
import { AccountMode, AlpacaCredentials } from '../types/alpaca.js';
import { createLogger } from '../services/logger.js';

dotenv.config();

const log = createLogger('Config');

let currentMode: AccountMode = (
  (process.env.ALPACA_ACCOUNT_MODE || process.env.ALPACA_MODE || 'paper').toLowerCase()
) as AccountMode;

if (currentMode !== 'paper' && currentMode !== 'live') {
  currentMode = 'paper';
}

export const ENDPOINTS = {
  paper: 'https://paper-api.alpaca.markets',
  live: 'https://api.alpaca.markets',
  data: 'https://data.alpaca.markets'
} as const;

export function getAccountMode(): AccountMode {
  return currentMode;
}

export function setAccountMode(mode: string): AccountMode {
  const normalizedMode = String(mode).toLowerCase() as AccountMode;
  if (normalizedMode !== 'paper' && normalizedMode !== 'live') {
    throw new Error(`Invalid account mode: "${mode}". Must be "paper" or "live".`);
  }
  currentMode = normalizedMode;
  log.info(`Switched Alpaca trading mode to: ${currentMode.toUpperCase()}`);
  return currentMode;
}

export function getAlpacaCredentials(): AlpacaCredentials {
  if (currentMode === 'live') {
    const liveKey = process.env.ALPACA_LIVE_KEY_ID;
    const liveSecret = process.env.ALPACA_LIVE_SECRET_KEY;

    if (liveKey && liveSecret) {
      return {
        baseUrl: ENDPOINTS.live,
        dataUrl: ENDPOINTS.data,
        keyId: liveKey,
        secretKey: liveSecret,
        mode: 'live'
      };
    }
    log.warn('Live credentials not found (ALPACA_LIVE_KEY_ID missing). Falling back to Paper Trading credentials.');
  }

  const paperKey = process.env.ALPACA_PAPER_KEY_ID || process.env.ALPACA_KEY_ID || process.env.ALPACA_API_KEY || process.env.CLIENT_KEY || '';
  const paperSecret = process.env.ALPACA_PAPER_SECRET_KEY || process.env.ALPACA_SECRET_KEY || process.env.ALPACA_API_SECRET || process.env.CLIENT_SECRET || '';

  return {
    baseUrl: ENDPOINTS.paper,
    dataUrl: ENDPOINTS.data,
    keyId: paperKey,
    secretKey: paperSecret,
    mode: 'paper'
  };
}
