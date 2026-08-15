import dotenv from 'dotenv';
import { getAlpacaCredentials, getAccountMode } from '../src/config/alpaca.js';
import { clearAllCache } from '../src/services/cacheService.js';

dotenv.config();

async function cancelAllPendingOrders() {
  const creds = getAlpacaCredentials();
  const mode = getAccountMode();

  console.log(`[CancelAllOrders] Target Account Mode: ${mode.toUpperCase()}`);
  console.log(`[CancelAllOrders] Using API Base URL: ${creds.baseUrl}`);

  const url = `${creds.baseUrl}/v2/orders`;
  const headers = {
    'APCA-API-KEY-ID': creds.keyId,
    'APCA-API-SECRET-KEY': creds.secretKey,
    'Content-Type': 'application/json'
  };

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (!response.ok) {
      console.error(`[CancelAllOrders] Error (HTTP ${response.status}):`, data);
      process.exit(1);
    }

    console.log(`[CancelAllOrders] Successfully sent request to cancel all pending orders.`);
    console.log(`[CancelAllOrders] Alpaca Response:`, JSON.stringify(data, null, 2));

    await clearAllCache();
    console.log(`[CancelAllOrders] Cache cleared. All pending orders have been canceled.`);
    process.exit(0);
  } catch (err: any) {
    console.error(`[CancelAllOrders] Failed to cancel orders:`, err.message);
    process.exit(1);
  }
}

cancelAllPendingOrders();
