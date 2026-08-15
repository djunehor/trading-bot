import { getAccountMode, getAlpacaCredentials } from '../src/config/alpaca.js';
import { getLatestBar } from '../src/services/alpacaService.js';

async function verifyStockPrices() {
  const args = process.argv.slice(2);
  const symbols = args.length > 0
    ? args.map(s => s.toUpperCase())
    : ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN', 'META', 'GOOGL'];

  const mode = getAccountMode();
  const creds = getAlpacaCredentials();

  console.log(`\n=================================================`);
  console.log(`  Alpaca Real-Time Stock Price Verification Tool `);
  console.log(`=================================================`);
  console.log(`Mode: ${mode.toUpperCase()}`);
  console.log(`Endpoint: ${creds.baseUrl}`);
  console.log(`Data Endpoint: ${creds.dataUrl}`);
  console.log(`Target Symbols: ${symbols.join(', ')}\n`);

  console.log(`Fetching price bars from Alpaca API...\n`);

  const results: Array<{ Symbol: string; Price: string; Timestamp: string; Status: string }> = [];

  for (const symbol of symbols) {
    try {
      const bar = await getLatestBar(symbol);
      if (bar && typeof bar.c === 'number') {
        results.push({
          Symbol: symbol,
          Price: `$${bar.c.toFixed(2)}`,
          Timestamp: bar.t ? new Date(bar.t).toLocaleString() : 'Latest',
          Status: 'SUCCESS ✅'
        });
      } else {
        results.push({
          Symbol: symbol,
          Price: 'N/A',
          Timestamp: 'N/A',
          Status: 'NO DATA ⚠️'
        });
      }
    } catch (error: any) {
      results.push({
        Symbol: symbol,
        Price: 'ERROR',
        Timestamp: 'N/A',
        Status: `FAILED: ${error.message} ❌`
      });
    }
  }

  console.table(results);
  console.log(`\nPrice verification complete.\n`);
}

verifyStockPrices().catch(err => {
  console.error('Fatal error during price verification:', err);
  process.exit(1);
});
