import { getAccountMode, getAlpacaCredentials } from '../src/config/alpaca.js';
import { getAccount, getPositions, getOrders } from '../src/services/alpacaService.js';
import { getPositionsDb, getOrdersDb } from '../src/db/database.js';

async function portfolioStatusCLI() {
  const args = process.argv.slice(2);
  const targetSymbol = args[0] ? args[0].toUpperCase() : null;

  const mode = getAccountMode();
  const creds = getAlpacaCredentials();

  console.log(`\n=================================================`);
  console.log(`  Alpaca Portfolio & Position Status Tool       `);
  console.log(`=================================================`);
  console.log(`Account Mode: ${mode.toUpperCase()} ${mode === 'live' ? '⚠️ REAL MONEY' : '(Simulation)'}`);
  console.log(`Endpoint: ${creds.baseUrl}`);
  if (targetSymbol) {
    console.log(`Filtering Symbol: ${targetSymbol}`);
  }
  console.log(`-------------------------------------------------\n`);

  try {
    // 1. Fetch Account Info
    const account = await getAccount();
    console.log(`Account Status: ${account.status.toUpperCase()}`);
    console.log(`Portfolio Equity: $${parseFloat(account.equity || '0').toFixed(2)}`);
    console.log(`Buying Power: $${parseFloat(account.buying_power || '0').toFixed(2)}`);
    console.log(`Cash Balance: $${parseFloat(account.cash || '0').toFixed(2)}\n`);

    // 2. Fetch Filled Open Positions
    const positions = await getPositions();
    let filteredPositions = Array.isArray(positions) ? positions : [];
    if (targetSymbol) {
      filteredPositions = filteredPositions.filter(p => p.symbol === targetSymbol);
    }

    console.log(`--- FILLED OPEN POSITIONS (${filteredPositions.length}) ---`);
    if (filteredPositions.length === 0) {
      console.log(`ℹ️ No filled open positions found${targetSymbol ? ` for ${targetSymbol}` : ''}.\n`);
    } else {
      console.table(filteredPositions.map(p => ({
        Symbol: p.symbol,
        Qty: p.qty,
        'Avg Entry': `$${parseFloat(p.avg_entry_price).toFixed(2)}`,
        'Current Price': `$${parseFloat(p.current_price || '0').toFixed(2)}`,
        'Market Value': `$${parseFloat(p.market_value).toFixed(2)}`,
        'Unrealized P/L': `$${parseFloat(p.unrealized_pl || '0').toFixed(2)}`
      })));
      console.log('');
    }

    // 3. Fetch Pending Orders (Queued for Market Open)
    const openOrders = await getOrders('open', 50);
    let filteredOrders = Array.isArray(openOrders) ? openOrders : [];
    if (targetSymbol) {
      filteredOrders = filteredOrders.filter(o => o.symbol === targetSymbol);
    }

    console.log(`--- PENDING OPEN ORDERS QUEUE (${filteredOrders.length}) ---`);
    if (filteredOrders.length === 0) {
      console.log(`ℹ️ No pending open orders found${targetSymbol ? ` for ${targetSymbol}` : ''}.\n`);
    } else {
      console.table(filteredOrders.map(o => ({
        'Order ID': o.id,
        Symbol: o.symbol,
        Side: o.side.toUpperCase(),
        Qty: o.qty,
        Type: o.type.toUpperCase(),
        Status: o.status.toUpperCase(),
        SubmittedAt: new Date(o.submitted_at).toLocaleString()
      })));
      console.log('');
    }

    // 4. SQLite Database Cached Record Summary
    const dbPositions = getPositionsDb(mode);
    const dbOrders = getOrdersDb(mode, 10);
    console.log(`--- SQLITE DATABASE CACHED SUMMARY ---`);
    console.log(`Cached Positions Count: ${dbPositions.length}`);
    console.log(`Recent Cached Orders Count: ${dbOrders.length}\n`);

  } catch (error: any) {
    console.error(`❌ PORTFOLIO STATUS FETCH FAILED: ${error.message}`);
    process.exit(1);
  }
}

portfolioStatusCLI().catch(err => {
  console.error('Fatal error during portfolio status execution:', err);
  process.exit(1);
});
