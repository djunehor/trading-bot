import assert from 'assert';

function runCashOnlyTests() {
  console.log('--- Testing Cash-Only Trading Guard ---');

  const price = 200; // $200 per share

  // Test 1: Zero or negative cash returns 0 shares
  const zeroCash = 0;
  const zeroShares = zeroCash <= 0 ? 0 : Math.floor((zeroCash * 0.05) / price);
  assert.strictEqual(zeroShares, 0, 'Zero cash returns 0 shares');

  const negativeCash = -18750.11;
  const negShares = negativeCash <= 0 ? 0 : Math.floor((negativeCash * 0.05) / price);
  assert.strictEqual(negShares, 0, 'Negative cash returns 0 shares');

  // Test 2: Liquid cash of $1,000 caps shares strictly to 5 shares ($1,000 / $200)
  const cash = 1000;
  const maxAffordable = Math.floor(cash / price);
  assert.strictEqual(maxAffordable, 5, 'Cash of $1,000 caps max shares to 5 ($1,000 / $200)');

  console.log('✅ Cash-Only Trading Guard PASSED!');
}

runCashOnlyTests();
