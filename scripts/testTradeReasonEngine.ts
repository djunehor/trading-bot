import assert from 'assert';
import { saveOrderDb, getOrdersDb } from '../src/db/database.js';
import { AlpacaOrder } from '../src/types/alpaca.js';

function runReasonTests() {
  console.log('--- Testing Trade Reason Database Persistence ---');

  const mockOrder: AlpacaOrder = {
    id: `test_reason_ord_${Date.now()}`,
    client_order_id: `cli_${Date.now()}`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    submitted_at: new Date().toISOString(),
    filled_at: new Date().toISOString(),
    expired_at: null,
    canceled_at: null,
    failed_at: null,
    replaced_at: null,
    replaced_by: null,
    replaces: null,
    asset_id: 'ast_test',
    symbol: 'PLTR',
    asset_class: 'us_equity',
    notional: null,
    qty: '10',
    filled_qty: '10',
    filled_avg_price: '158.33',
    order_class: '',
    order_type: 'market',
    type: 'market',
    side: 'sell',
    time_in_force: 'day',
    limit_price: null,
    stop_price: null,
    status: 'filled',
    extended_hours: false,
    legs: null,
    trail_percent: null,
    trail_price: null,
    hwm: null
  };

  const reasonNote = 'Trailing Stop: 1.52% drop from peak $158.33';
  saveOrderDb(mockOrder, 'paper', reasonNote);

  const res = getOrdersDb('paper', 500, 0);
  const saved = res.data.find(o => o.id === mockOrder.id);

  assert.ok(saved, 'Saved order found in DB');
  assert.strictEqual(saved.reason, reasonNote, 'Reason note matches saved input');

  console.log('✅ Trade Reason Database Persistence PASSED!');
}

runReasonTests();
