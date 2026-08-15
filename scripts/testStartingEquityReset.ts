import { resetBotSessionDb, getBotStateDb, saveBotStateDb } from '../src/db/database.js';

function testResetLogic() {
  console.log('--- Testing Starting Equity Baseline Reset Logic ---');
  
  const initialMode = 'paper_test';
  
  // 1. Reset bot session DB with equity 99693.48
  resetBotSessionDb(initialMode, 99692.34);
  const stateAfterReset = getBotStateDb(initialMode);
  console.log('State after resetBotSessionDb:', stateAfterReset);

  if (stateAfterReset.startingEquity !== 99692.34) {
    throw new Error(`Expected startingEquity to be 99692.34, got ${stateAfterReset.startingEquity}`);
  }

  // 2. Save bot state with updated startingEquity
  saveBotStateDb(true, { strategy: 'news_sentiment' } as any, initialMode, 99700.00);
  const stateAfterSave = getBotStateDb(initialMode);
  console.log('State after saveBotStateDb:', stateAfterSave);

  if (stateAfterSave.startingEquity !== 99700.00) {
    throw new Error(`Expected startingEquity to be 99700.00, got ${stateAfterSave.startingEquity}`);
  }

  // Clean up
  resetBotSessionDb(initialMode, 100000);
  console.log('✅ Baseline Reset Logic Test PASSED!');
}

testResetLogic();
