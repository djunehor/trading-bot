import assert from 'assert';
import { calculateRealizedPlFromOrders } from '../src/services/alpacaService.js';

async function runRealizedPLTest() {
  console.log('--- Testing FIFO Realized P/L Calculation ---');
  const realizedPl = await calculateRealizedPlFromOrders();
  console.log(`Computed Realized P/L from closed sales: $${realizedPl.toFixed(2)}`);
  assert.ok(typeof realizedPl === 'number', 'Realized P/L must be a number');
  assert.ok(realizedPl > 0, 'Realized P/L from completed profitable sales must be positive');
  console.log('✅ Realized P/L Calculation Test PASSED!');
}

runRealizedPLTest();
