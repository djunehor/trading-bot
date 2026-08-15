import { getTopCryptoMovers, getLatestBar } from '../src/services/alpacaService.js';
import { isMarketOpenOrOpeningSoon, startBot, stopBot } from '../src/services/tradingBot.js';

console.log('--- Testing Crypto Trading Engine ---');

async function runTest() {
  // 1. Verify dynamic crypto movers discovery
  const cryptoMovers = await getTopCryptoMovers();
  console.log(`Discovered ${cryptoMovers.length} top crypto movers: ${cryptoMovers.slice(0, 5).join(', ')}`);

  if (!Array.isArray(cryptoMovers) || cryptoMovers.length === 0) {
    console.error('[FAIL] Dynamic crypto movers list is empty!');
    process.exit(1);
  }

  // 2. Verify 24/7 market open check for crypto
  const botStatus = startBot({ assetClass: 'crypto' });
  const is247Open = isMarketOpenOrOpeningSoon();
  console.log(`isMarketOpenOrOpeningSoon() for crypto asset class: ${is247Open}`);

  if (!is247Open) {
    console.error('[FAIL] Crypto market open check failed! Crypto should trade 24/7.');
    stopBot();
    process.exit(1);
  }

  stopBot();
  console.log('[SUCCESS] Crypto trading engine and 24/7 market logic verified successfully.');
}

runTest().catch((err) => {
  console.error('[FAIL] Crypto test error:', err.message);
  process.exit(1);
});
