import dotenv from 'dotenv';
import { getPositions, closePosition, cancelOrder, getOrders } from '../src/services/alpacaService.js';
import { getAlpacaCredentials, getAccountMode } from '../src/config/alpaca.js';
import { clearAllCache } from '../src/services/cacheService.js';

dotenv.config();

async function resetPaperAccount() {
  const mode = getAccountMode();
  const creds = getAlpacaCredentials();

  console.log(`=== RESETTING ACCOUNT HOLDINGS & ORDERS ===`);
  console.log(`Account Mode: ${mode.toUpperCase()}`);

  try {
    // 1. Cancel all open pending orders
    const url = `${creds.baseUrl}/v2/orders`;
    const headers = {
      'APCA-API-KEY-ID': creds.keyId,
      'APCA-API-SECRET-KEY': creds.secretKey,
      'Content-Type': 'application/json'
    };

    const cancelRes = await fetch(url, { method: 'DELETE', headers });
    console.log(`[Reset] Cancel open orders response status: ${cancelRes.status}`);

    // 2. Liquidate all open positions
    const positions = await getPositions();
    console.log(`[Reset] Found ${positions.length} open positions to close.`);

    for (const pos of positions) {
      console.log(`[Reset] Closing position: ${pos.qty} shares of ${pos.symbol}...`);
      try {
        await closePosition(pos.symbol);
        console.log(`[Reset] Successfully closed position for ${pos.symbol}.`);
      } catch (err: any) {
        console.warn(`[Reset] Failed to close position ${pos.symbol}:`, err.message);
      }
    }

    // 3. Clear cache
    await clearAllCache();
    console.log(`[Reset] Account holdings reset successfully. All positions closed and orders canceled.`);
    process.exit(0);
  } catch (err: any) {
    console.error(`[Reset] Failed to reset paper account:`, err.message);
    process.exit(1);
  }
}

resetPaperAccount();
