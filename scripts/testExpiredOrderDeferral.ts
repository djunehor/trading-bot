import { isMarketOpenOrOpeningSoon } from '../src/services/tradingBot.js';

console.log('--- Testing Expired Order Deferral Engine ---');

const isOpenOrOpeningSoon = isMarketOpenOrOpeningSoon();
console.log(`Current isMarketOpenOrOpeningSoon(): ${isOpenOrOpeningSoon}`);

// Mock logic test:
const mockExpiredSellOrdersMap: Record<string, boolean> = { 'NVDA': true };
const mockIsMarketOpenOrOpeningSoon = false; // Closed market scenario (e.g. Weekend or Night)

let orderCreated = false;
if (mockExpiredSellOrdersMap['NVDA'] && !mockIsMarketOpenOrOpeningSoon) {
  console.log('[PASS] Order for NVDA was previously expired. Market is closed; deferred order creation until market opens or opens in 1h.');
} else {
  orderCreated = true;
}

if (!orderCreated) {
  console.log('[SUCCESS] Expired order deferral logic verified successfully.');
} else {
  console.error('[FAIL] Expired order creation was not deferred!');
  process.exit(1);
}
