import { getAccountMode, getAlpacaCredentials } from '../src/config/alpaca.js';
import { createOrder } from '../src/services/alpacaService.js';
import { OrderType } from '../src/types/alpaca.js';

async function buyStockCLI() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
=================================================
  Alpaca Stock Purchase CLI Tool
=================================================

Usage:
  npx tsx scripts/buyStock.ts <SYMBOL> <QUANTITY> [TYPE] [LIMIT_PRICE]

Examples:
  npx tsx scripts/buyStock.ts AAPL 1
  npx tsx scripts/buyStock.ts NVDA 2 limit 210.50
    `);
    process.exit(0);
  }

  const symbol = args[0].toUpperCase();
  const qty = parseInt(args[1] || '1', 10);
  const type = (args[2] ? args[2].toLowerCase() : 'market') as OrderType;
  const limit_price = args[3] ? parseFloat(args[3]) : undefined;

  if (isNaN(qty) || qty <= 0) {
    console.error('Error: Quantity must be a positive integer.');
    process.exit(1);
  }

  const mode = getAccountMode();
  const creds = getAlpacaCredentials();

  console.log(`\n=================================================`);
  console.log(`  Alpaca Stock Purchase Execution CLI Tool      `);
  console.log(`=================================================`);
  console.log(`Account Mode: ${mode.toUpperCase()} ${mode === 'live' ? '⚠️ REAL MONEY' : '(Simulation)'}`);
  console.log(`Broker Endpoint: ${creds.baseUrl}`);
  console.log(`Target Symbol: ${symbol}`);
  console.log(`Quantity: ${qty}`);
  console.log(`Order Type: ${type.toUpperCase()}`);
  if (type === 'limit' && limit_price) {
    console.log(`Limit Price: $${limit_price.toFixed(2)}`);
  }
  console.log(`-------------------------------------------------\n`);

  console.log(`Submitting BUY order to Alpaca API...\n`);

  try {
    // 1. Send order request to Alpaca API
    const order = await createOrder({
      symbol,
      qty,
      side: 'buy',
      type,
      limit_price
    });

    // 2. Verify response returned valid order object and status from Alpaca
    if (!order || !order.id || !order.status) {
      throw new Error('Alpaca response did not contain a valid order ID or status.');
    }

    // 3. Log success ONLY after Alpaca HTTP response is verified
    console.log(`✅ ALPACA API CONFIRMED ORDER RECEIPT!`);
    console.log(`   Order ID: ${order.id}`);
    console.log(`   Status: ${order.status.toUpperCase()}\n`);

    console.table([{
      'Order ID': order.id,
      Symbol: order.symbol,
      Side: order.side.toUpperCase(),
      Qty: order.qty,
      Type: order.type.toUpperCase(),
      Status: order.status.toUpperCase(),
      Mode: mode.toUpperCase(),
      SubmittedAt: new Date(order.submitted_at).toLocaleString()
    }]);

  } catch (error: any) {
    console.error(`❌ ALPACA ORDER REJECTED / FAILED: ${error.message}`);
    process.exit(1);
  }
}

buyStockCLI().catch(err => {
  console.error('Fatal error during stock purchase CLI execution:', err);
  process.exit(1);
});
