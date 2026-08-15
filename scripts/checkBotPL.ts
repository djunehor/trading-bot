import dotenv from 'dotenv';
import { getAccount, getPositions, getOrders } from '../src/services/alpacaService.js';
import { getAccountMode } from '../src/config/alpaca.js';

dotenv.config();

async function checkPerformance() {
  try {
    const mode = getAccountMode();
    console.log(`=== BOT PERFORMANCE AUDIT ===`);
    console.log(`Account Mode: ${mode.toUpperCase()}`);

    const account = await getAccount();
    console.log(`\n--- Account Metrics ---`);
    console.log(`Equity: $${parseFloat(account.equity).toFixed(2)}`);
    console.log(`Cash: $${parseFloat(account.cash).toFixed(2)}`);
    console.log(`Buying Power: $${parseFloat(account.buying_power).toFixed(2)}`);
    console.log(`Portfolio Value: $${parseFloat(account.portfolio_value).toFixed(2)}`);
    console.log(`Status: ${account.status}`);

    const positions = await getPositions();
    console.log(`\n--- Open Positions (${positions.length}) ---`);
    let totalUnrealizedPL = 0;
    if (positions.length === 0) {
      console.log('No open positions.');
    } else {
      positions.forEach(p => {
        const pl = parseFloat(p.unrealized_pl || '0');
        totalUnrealizedPL += pl;
        console.log(`Symbol: ${p.symbol} | Qty: ${p.qty} | Avg Entry: $${parseFloat(p.avg_entry_price).toFixed(2)} | Market Value: $${parseFloat(p.market_value).toFixed(2)} | Unrealized P/L: $${pl.toFixed(2)}`);
      });
      console.log(`Total Unrealized P/L: $${totalUnrealizedPL.toFixed(2)}`);
    }

    const filledOrders = await getOrders('closed', 50);
    console.log(`\n--- Recent Closed Orders (${filledOrders.length}) ---`);
    if (filledOrders.length === 0) {
      console.log('No closed orders yet.');
    } else {
      filledOrders.slice(0, 10).forEach(o => {
        console.log(`ID: ${o.id.substring(0,8)}... | Symbol: ${o.symbol} | Side: ${o.side.toUpperCase()} | Qty: ${o.qty} | Status: ${o.status} | Submitted: ${o.submitted_at}`);
      });
    }

    process.exit(0);
  } catch (err: any) {
    console.error('Audit failed:', err.message);
    process.exit(1);
  }
}

checkPerformance();
