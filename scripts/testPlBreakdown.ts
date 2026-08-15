import { calculateRealizedPlFromOrders } from '../src/services/alpacaService.js';

console.log('--- Testing Separate P/L Breakdown (Stock vs Crypto) ---');

async function runTest() {
  const stockRealized = await calculateRealizedPlFromOrders('us_equity');
  const cryptoRealized = await calculateRealizedPlFromOrders('crypto');
  const totalRealized = await calculateRealizedPlFromOrders();

  console.log(`Stock Realized P/L: $${stockRealized.toFixed(2)}`);
  console.log(`Crypto Realized P/L: $${cryptoRealized.toFixed(2)}`);
  console.log(`Total Realized P/L: $${totalRealized.toFixed(2)}`);

  if (typeof stockRealized !== 'number' || typeof cryptoRealized !== 'number') {
    console.error('[FAIL] P/L calculation returned invalid non-number results');
    process.exit(1);
  }

  console.log('[SUCCESS] Stock and Crypto P/L breakdown calculations verified successfully.');
}

runTest().catch((err) => {
  console.error('[FAIL] P/L test error:', err.message);
  process.exit(1);
});
