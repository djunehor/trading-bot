import { getAccountMode, getAlpacaCredentials } from '../src/config/alpaca.js';
import { getOrders, cancelOrder } from '../src/services/alpacaService.js';

async function cancelOrderCLI() {
  const args = process.argv.slice(2);
  const mode = getAccountMode();
  const creds = getAlpacaCredentials();

  console.log(`\n=================================================`);
  console.log(`  Alpaca Pending Order Cancelation CLI Tool     `);
  console.log(`=================================================`);
  console.log(`Account Mode: ${mode.toUpperCase()} ${mode === 'live' ? '⚠️ REAL MONEY' : '(Simulation)'}`);
  console.log(`Broker Endpoint: ${creds.baseUrl}\n`);

  console.log(`Fetching active open/pending orders from Alpaca...\n`);

  try {
    const openOrders = await getOrders('open', 50);

    if (!Array.isArray(openOrders) || openOrders.length === 0) {
      console.log(`ℹ️ No pending orders currently open/on-hold for ${mode.toUpperCase()} mode.\n`);
      process.exit(0);
    }

    console.log(`Found ${openOrders.length} pending order(s):\n`);
    console.table(openOrders.map(o => ({
      'Order ID': o.id,
      Symbol: o.symbol,
      Side: o.side.toUpperCase(),
      Qty: o.qty,
      Type: o.type.toUpperCase(),
      Status: o.status.toUpperCase(),
      SubmittedAt: new Date(o.submitted_at).toLocaleString()
    })));

    if (args.length === 0) {
      console.log(`
Usage:
  npx tsx scripts/cancelOrder.ts <ORDER_ID>      (Cancel specific order ID)
  npx tsx scripts/cancelOrder.ts <SYMBOL>        (Cancel all pending orders for symbol)
  npx tsx scripts/cancelOrder.ts --all           (Cancel ALL pending orders)
      `);
      process.exit(0);
    }

    const target = args[0];

    if (target === '--all') {
      console.log(`\nCanceling ALL ${openOrders.length} pending orders...\n`);
      for (const ord of openOrders) {
        await cancelOrder(ord.id);
        console.log(`✅ CANCELED pending order ${ord.id} (${ord.symbol} ${ord.side.toUpperCase()} ${ord.qty})`);
      }
      console.log(`\nAll pending orders canceled successfully.\n`);
      process.exit(0);
    }

    // Check if target matches symbol
    const matchingSymbolOrders = openOrders.filter(o => o.symbol === target.toUpperCase());
    if (matchingSymbolOrders.length > 0) {
      console.log(`\nCanceling ${matchingSymbolOrders.length} pending order(s) for symbol ${target.toUpperCase()}...\n`);
      for (const ord of matchingSymbolOrders) {
        await cancelOrder(ord.id);
        console.log(`✅ CANCELED pending order ${ord.id} (${ord.symbol} ${ord.side.toUpperCase()} ${ord.qty})`);
      }
      process.exit(0);
    }

    // Treat target as Order ID
    const matchingIdOrder = openOrders.find(o => o.id === target);
    if (matchingIdOrder) {
      console.log(`\nCanceling pending order ID: ${target}...\n`);
      await cancelOrder(target);
      console.log(`✅ CANCELED pending order ${target} (${matchingIdOrder.symbol} ${matchingIdOrder.side.toUpperCase()} ${matchingIdOrder.qty})`);
      process.exit(0);
    }

    console.error(`❌ Order or Symbol matching "${target}" not found in current open pending orders.`);
    process.exit(1);

  } catch (error: any) {
    console.error(`❌ CANCELATION FAILED: ${error.message}`);
    process.exit(1);
  }
}

cancelOrderCLI().catch(err => {
  console.error('Fatal error during order cancelation CLI execution:', err);
  process.exit(1);
});
