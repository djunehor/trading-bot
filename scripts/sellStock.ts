import { getAccountMode, getAlpacaCredentials } from '../src/config/alpaca.js';
import { createOrder, getPositions, closePosition } from '../src/services/alpacaService.js';
import { OrderType } from '../src/types/alpaca.js';

async function sellStockCLI() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
=================================================
  Alpaca Stock Sale CLI Tool
=================================================

Usage:
  npx tsx scripts/sellStock.ts <SYMBOL> [QUANTITY] [TYPE] [LIMIT_PRICE]

Examples:
  npx tsx scripts/sellStock.ts AAPL
  npx tsx scripts/sellStock.ts TSLA 5
  npx tsx scripts/sellStock.ts NVDA 2 limit 220.00

Note:
  If QUANTITY is omitted or set to 'ALL', the script will close the full open position for the symbol.
    `);
    process.exit(0);
  }

  const symbol = args[0].toUpperCase();
  const qtyArg = args[1] ? args[1].toUpperCase() : 'ALL';
  const type = (args[2] ? args[2].toLowerCase() : 'market') as OrderType;
  const limit_price = args[3] ? parseFloat(args[3]) : undefined;

  const mode = getAccountMode();
  const creds = getAlpacaCredentials();

  console.log(`\n=================================================`);
  console.log(`  Alpaca Stock Sale Execution CLI Tool          `);
  console.log(`=================================================`);
  console.log(`Account Mode: ${mode.toUpperCase()} ${mode === 'live' ? '⚠️ REAL MONEY' : '(Simulation)'}`);
  console.log(`Broker Endpoint: ${creds.baseUrl}`);
  console.log(`Target Symbol: ${symbol}`);
  console.log(`Requested Quantity: ${qtyArg}`);
  console.log(`Order Type: ${type.toUpperCase()}`);
  if (type === 'limit' && limit_price) {
    console.log(`Limit Price: $${limit_price.toFixed(2)}`);
  }
  console.log(`-------------------------------------------------\n`);

  console.log(`Verifying open position for ${symbol}...\n`);

  try {
    const positions = await getPositions();
    const openPos = Array.isArray(positions) ? positions.find(p => p.symbol === symbol) : null;

    if (!openPos) {
      console.error(`❌ CANNOT SELL: No open position found for symbol "${symbol}".`);
      process.exit(1);
    }

    const availableQty = Math.abs(parseInt(openPos.qty, 10));
    console.log(`Found open position: ${availableQty} shares of ${symbol} (Avg Entry: $${openPos.avg_entry_price}).`);

    let sellQty = availableQty;
    if (qtyArg !== 'ALL') {
      const parsedQty = parseInt(qtyArg, 10);
      if (isNaN(parsedQty) || parsedQty <= 0) {
        console.error('Error: Quantity must be a positive integer or "ALL".');
        process.exit(1);
      }
      if (parsedQty > availableQty) {
        console.error(`Error: Requested sell quantity (${parsedQty}) exceeds available shares (${availableQty}).`);
        process.exit(1);
      }
      sellQty = parsedQty;
    }

    console.log(`Submitting SELL order for ${sellQty} share(s) of ${symbol} to Alpaca API...\n`);

    let order;
    if (sellQty === availableQty && type === 'market') {
      order = await closePosition(symbol);
    } else {
      order = await createOrder({
        symbol,
        qty: sellQty,
        side: 'sell',
        type,
        limit_price
      });
    }

    // Verify response payload
    if (!order || !order.id || !order.status) {
      throw new Error('Alpaca response did not contain a valid order ID or status.');
    }

    console.log(`✅ ALPACA API CONFIRMED SALE ORDER RECEIPT!`);
    console.log(`   Order ID: ${order.id}`);
    console.log(`   Status: ${order.status.toUpperCase()}\n`);

    console.table([{
      'Order ID': order.id,
      Symbol: order.symbol,
      Side: 'SELL',
      Qty: order.qty || sellQty,
      Type: (order.type || type).toUpperCase(),
      Status: order.status.toUpperCase(),
      Mode: mode.toUpperCase(),
      SubmittedAt: order.submitted_at ? new Date(order.submitted_at).toLocaleString() : 'Just now'
    }]);

  } catch (error: any) {
    console.error(`❌ ALPACA SALE ORDER FAILED: ${error.message}`);
    process.exit(1);
  }
}

sellStockCLI().catch(err => {
  console.error('Fatal error during stock sale CLI execution:', err);
  process.exit(1);
});
