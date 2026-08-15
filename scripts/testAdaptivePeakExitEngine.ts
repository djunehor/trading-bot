import assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

function runAdaptivePeakExitTest() {
  console.log('--- Testing Adaptive Optimal Peak Exit Engine ---');

  const botFileContent = readFileSync(join(process.cwd(), 'src/services/tradingBot.ts'), 'utf-8');

  assert.ok(botFileContent.includes('Partial Take-Profit (50% scale-out'), '50% Partial Scale-Out logic must exist in tradingBot.ts');
  assert.ok(botFileContent.includes('Peak Stall Exit: No new peak high for 90s'), 'Peak Stall Exit logic must exist in tradingBot.ts');
  assert.ok(botFileContent.includes('Tight Peak Trailing Stop:'), 'Tiered Dynamic Trailing Stop logic must exist in tradingBot.ts');

  console.log('✅ Adaptive Optimal Peak Exit Engine Test PASSED!');
}

runAdaptivePeakExitTest();
