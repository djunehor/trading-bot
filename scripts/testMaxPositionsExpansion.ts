import assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

function runMaxPositionsTest() {
  console.log('--- Testing Max Positions Expansion to 10 ---');

  const botFileContent = readFileSync(join(process.cwd(), 'src/services/tradingBot.ts'), 'utf-8');
  assert.ok(botFileContent.includes('const MAX_POSITIONS = 10;'), 'MAX_POSITIONS must be set to 10 in tradingBot.ts');

  console.log('✅ Max Positions Expansion Test PASSED!');
}

runMaxPositionsTest();
