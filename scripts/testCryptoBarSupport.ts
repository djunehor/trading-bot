/**
 * testCryptoBarSupport.ts
 * Hits the real Alpaca crypto bar API for every candidate symbol.
 * Prints PASS or FAIL for each one. No mocks, no assumptions.
 */

import dotenv from 'dotenv';
dotenv.config();

import { getAlpacaCredentials } from '../src/config/alpaca.js';

const ALL_CANDIDATES = [
  'BTC/USD', 'ETH/USD', 'SOL/USD', 'DOGE/USD',
  'AVAX/USD', 'LINK/USD', 'UNI/USD', 'BCH/USD',
  'LTC/USD', 'DOT/USD', 'AAVE/USD', 'XRP/USD', 'MATIC/USD'
];

async function testBar(symbol: string, keyId: string, secretKey: string, dataUrl: string): Promise<boolean> {
  const url = `${dataUrl}/v1beta3/crypto/us/latest/bars?symbols=${encodeURIComponent(symbol)}`;
  try {
    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': keyId,
        'APCA-API-SECRET-KEY': secretKey,
        'Content-Type': 'application/json'
      }
    });
    if (!res.ok) {
      console.log(`  FAIL  ${symbol} — HTTP ${res.status}`);
      return false;
    }
    const data = (await res.json()) as { bars?: Record<string, any> };
    const bar = data.bars?.[symbol];
    if (!bar || bar.c === undefined) {
      console.log(`  FAIL  ${symbol} — no bar data in response`);
      return false;
    }
    console.log(`  PASS  ${symbol} — close price $${bar.c}`);
    return true;
  } catch (err: any) {
    console.log(`  FAIL  ${symbol} — exception: ${err.message}`);
    return false;
  }
}

async function main() {
  const creds = getAlpacaCredentials();
  console.log(`\nTesting Alpaca crypto bar API (${creds.mode.toUpperCase()}) for ${ALL_CANDIDATES.length} symbols...\n`);

  const passed: string[] = [];
  const failed: string[] = [];

  for (const sym of ALL_CANDIDATES) {
    const ok = await testBar(sym, creds.keyId, creds.secretKey, creds.dataUrl);
    if (ok) passed.push(sym);
    else failed.push(sym);
  }

  console.log(`\n--- SUMMARY ---`);
  console.log(`SUPPORTED (${passed.length}): ${passed.join(', ')}`);
  console.log(`NOT SUPPORTED (${failed.length}): ${failed.join(', ')}`);
  console.log(`\nOnly the SUPPORTED list should be in the bot watchlist.`);
}

main().catch(console.error);
