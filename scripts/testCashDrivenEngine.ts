import assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

function runCashDrivenTest() {
  console.log('--- Testing Pure Cash-Driven Trading Logic ---');

  const botFileContent = readFileSync(join(process.cwd(), 'src/services/tradingBot.ts'), 'utf-8');
  assert.ok(!botFileContent.includes('Position limit reached'), 'Position limit restriction must be removed from checkSafetyLimits');

  console.log('✅ Pure Cash-Driven Trading Test PASSED!');
}

runCashDrivenTest();
