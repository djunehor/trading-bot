import 'dotenv/config';

async function main() {
  const key = process.env.ALPACA_PAPER_KEY_ID;
  const secret = process.env.ALPACA_PAPER_SECRET_KEY;

  let token: string | null = null;
  let pages = 0;
  let totalBars = 0;
  let firstBar: any = null;
  let lastBar: any = null;

  do {
    const page = token ? `&page_token=${token}` : '';
    const url = `https://data.alpaca.markets/v2/stocks/NFLX/bars?timeframe=5Min&start=2025-09-26T00:00:00Z&end=2026-09-26T00:00:00Z&limit=10000&adjustment=all&sort=asc${page}`;
    const res = await fetch(url, { headers: { 'APCA-API-KEY-ID': key!, 'APCA-API-SECRET-KEY': secret! } });
    const data = await res.json() as any;
    if (data.bars?.length) {
      if (!firstBar) firstBar = data.bars[0];
      lastBar = data.bars[data.bars.length - 1];
      totalBars += data.bars.length;
    }
    token = data.next_page_token || null;
    pages++;
  } while (token && pages < 50);

  console.log(`Fetched ${totalBars} bars across ${pages} pages.`);
  console.log('First bar date:', firstBar?.t, 'price:', firstBar?.c);
  console.log('Last bar date:', lastBar?.t, 'price:', lastBar?.c);
  console.log(`Split-adjusted return: ${((lastBar?.c - firstBar?.c) / firstBar?.c * 100).toFixed(2)}%`);
}

main().catch(console.error);
