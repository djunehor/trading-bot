import 'dotenv/config';

import { DEFAULT_STOCK_CONFIG } from '../src/services/botConfig.js';
import { runBacktest, summarize, toIsoDay } from '../src/services/backtestService.js';

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function printSummary(summary: ReturnType<typeof summarize>): void {
  console.log('\n════════════════════════ BACKTEST SUMMARY ════════════════════════');
  console.log(`Symbols: ${summary.symbols.join(', ')}`);
  console.log(`Trades: ${summary.trades}  |  Wins: ${summary.wins}  |  Losses: ${summary.losses}`);
  console.log(`Win rate: ${summary.winRate.toFixed(1)}%`);
  console.log(`Gross profit: $${summary.grossProfit.toFixed(2)}  |  Gross loss: $${summary.grossLoss.toFixed(2)}`);
  console.log(`Total P/L: $${summary.totalPnl.toFixed(2)}  |  Avg win: $${summary.avgWin.toFixed(2)}  |  Avg loss: $${summary.avgLoss.toFixed(2)}`);
  console.log(`Final equity: $${summary.finalEquity.toFixed(2)}  |  Max drawdown: $${summary.maxDrawdown.toFixed(2)}`);

  console.log('\nPer-trade log (worst 20 first):');
  for (const t of summary.tradesList.slice().sort((a, b) => a.pnl - b.pnl).slice(0, 20)) {
    console.log(`  ${t.exitTime.slice(0, 10)}  ${t.symbol.padEnd(6)}  ${t.reason.padEnd(14)}  entry $${t.entry.toFixed(2)} → exit $${t.exit.toFixed(2)}  P/L $${t.pnl.toFixed(2)}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const start = toIsoDay(readFlag(args, '--start') ?? '');
  const end = toIsoDay(readFlag(args, '--end') ?? '');
  const symbolsArg = readFlag(args, '--symbols');

  if (!start || !end) {
    console.log('Usage: npx tsx scripts/backtest.ts --start 2026-07-01 --end 2026-08-19 [--symbols AAPL,NVDA,TSLA]');
    console.log('If --symbols is omitted, the default stock watchlist is used.');
    process.exit(1);
  }

  const symbols = symbolsArg ? symbolsArg.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_STOCK_CONFIG.watchlist;

  console.log(`Backtesting ${symbols.length} symbols from ${start} to ${end}...`);

  const results = await runBacktest(symbols, start, end);
  for (const result of results) {
    const total = result.trades.reduce((sum, t) => sum + t.pnl, 0);
    console.log(`  ${result.symbol.padEnd(6)}  ${result.trades.length} trades  P/L $${total.toFixed(2)}`);
  }

  if (results.length > 0) {
    printSummary(summarize(results));
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
