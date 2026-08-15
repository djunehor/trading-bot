import { stockBot, cryptoBot, getAllBotsStatus, startBot, stopBot } from '../src/services/tradingBot.js';
import { getBotLogsDb, getOrdersDb } from '../src/db/database.js';

console.log('--- Testing Dual Bot Engine (Stock Bot vs Crypto Bot) ---');

async function runTest() {
  // 1. Verify initial status
  const initialStatus = getAllBotsStatus();
  console.log(`Stock Bot running: ${initialStatus.stockBot.isRunning}, Crypto Bot running: ${initialStatus.cryptoBot.isRunning}`);

  if (initialStatus.stockBot.isRunning || initialStatus.cryptoBot.isRunning) {
    stopBot('us_equity');
    stopBot('crypto');
  }

  // 2. Start Stock Bot independently
  console.log('Starting Stock Bot...');
  startBot({ assetClass: 'us_equity' });

  const statusAfterStockStart = getAllBotsStatus();
  console.log(`After Stock Start -> Stock Bot running: ${statusAfterStockStart.stockBot.isRunning}, Crypto Bot running: ${statusAfterStockStart.cryptoBot.isRunning}`);

  if (!statusAfterStockStart.stockBot.isRunning || statusAfterStockStart.cryptoBot.isRunning) {
    console.error('[FAIL] Stock Bot failed to start independently!');
    process.exit(1);
  }

  // 3. Start Crypto Bot independently
  console.log('Starting Crypto Bot...');
  startBot({ assetClass: 'crypto' });

  const statusAfterBothStart = getAllBotsStatus();
  console.log(`After Both Start -> Stock Bot running: ${statusAfterBothStart.stockBot.isRunning}, Crypto Bot running: ${statusAfterBothStart.cryptoBot.isRunning}`);

  if (!statusAfterBothStart.stockBot.isRunning || !statusAfterBothStart.cryptoBot.isRunning) {
    console.error('[FAIL] Both bots failed to run concurrently!');
    process.exit(1);
  }

  // 4. Stop Stock Bot while keeping Crypto Bot running
  console.log('Stopping Stock Bot only...');
  stopBot('us_equity');

  const statusAfterStockStop = getAllBotsStatus();
  console.log(`After Stock Stop -> Stock Bot running: ${statusAfterStockStop.stockBot.isRunning}, Crypto Bot running: ${statusAfterStockStop.cryptoBot.isRunning}`);

  if (statusAfterStockStop.stockBot.isRunning || !statusAfterStockStop.cryptoBot.isRunning) {
    console.error('[FAIL] Stock Bot failed to stop independently while Crypto Bot remained running!');
    process.exit(1);
  }

  // 5. Clean up by stopping Crypto Bot
  stopBot('crypto');
  console.log('[SUCCESS] Dual bot independent execution engine verified successfully.');
}

runTest().catch((err) => {
  console.error('[FAIL] Dual bot test error:', err.message);
  process.exit(1);
});
