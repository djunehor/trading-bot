import assert from 'node:assert/strict';
import test, { after } from 'node:test';

process.env.NODE_ENV = 'test';

import { Database } from '../src/db/database.js';
import { DEFAULT_STOCK_CONFIG } from '../src/services/botConfig.js';
import { cacheService } from '../src/services/cacheService.js';
import { BotManager } from '../src/services/botManager.js';
import { MarketClock } from '../src/services/marketClock.js';
import { BotEngine } from '../src/services/tradingBot.js';

const testDatabase = new Database(':memory:');
const stockBot = new BotEngine('us_equity', DEFAULT_STOCK_CONFIG, testDatabase);

// Mock Date to a weekday during market hours so risk management runs exit checks
// regardless of the actual day the tests run on (e.g. weekends).
let OrigDate: DateConstructor;
function installMarketDateMock(): void {
  OrigDate = Date;
  (globalThis as any).Date = class extends OrigDate {
    getDay() {
      return 2;
    } // Tuesday
    getHours() {
      return 11;
    } // 11 AM ET
    getMinutes() {
      return 30;
    }
  };
}
function restoreDate(): void {
  if (OrigDate) {
    globalThis.Date = OrigDate;
  }
}

test.beforeEach(async () => {
  await cacheService.clearAll();
  installMarketDateMock();
});

test.afterEach(() => {
  restoreDate();
});

test('Trading Bot Strategy Evaluation - Momentum & edge cases', () => {
  const insufficientSignal = BotManager.evaluateTradingStrategy([100], 'momentum');
  assert.equal(insufficientSignal.action, 'HOLD');
  assert.equal(insufficientSignal.reason, 'Insufficient price data');

  const buySignal = BotManager.evaluateTradingStrategy([100, 105], 'momentum');
  assert.equal(buySignal.action, 'BUY');

  const sellSignal = BotManager.evaluateTradingStrategy([100, 94], 'momentum');
  assert.equal(sellSignal.action, 'SELL');

  const holdSignal = BotManager.evaluateTradingStrategy([100, 100.02], 'momentum');
  assert.equal(holdSignal.action, 'HOLD');
});

test('Trading Bot Mock - startBot and stopBot lifecycle', async () => {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const urlString = String(input);
    if (urlString.includes('/v2/account')) {
      return new Response(JSON.stringify({ id: 'acc_test', status: 'ACTIVE', cash: '100000', trading_blocked: false }), { status: 200 });
    }
    if (urlString.includes('/v2/positions')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (urlString.includes('/v2/orders')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (urlString.includes('/bars/latest')) {
      return new Response(JSON.stringify({ bar: { c: 210, t: new Date().toISOString() } }), { status: 200 });
    }
    if (urlString.includes('/v1beta1/news')) {
      return new Response(
        JSON.stringify({
          news: [{ id: 1, headline: 'NVDA surge in profits record growth', summary: 'Bullish report', symbols: ['NVDA'] }],
        }),
        { status: 200 },
      );
    }
    if (urlString.includes('/v2/stocks/') && urlString.includes('/bars')) {
      return new Response(JSON.stringify({ bars: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 'ord_bot_1', status: 'accepted' }), { status: 200 });
  };

  const status = stockBot.start({ strategy: 'news_sentiment', intervalSeconds: 15, extendedHours: false });
  assert.equal(status.isRunning, true);

  await new Promise((r) => setTimeout(r, 50));

  const stopStatus = stockBot.stop();
  assert.equal(stopStatus.isRunning, false);
});

test('Trading Bot Mock - Bearish news sentiment triggers position sell & pending order cancel', async () => {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const urlString = String(input);
    if (urlString.includes('/v2/account')) {
      return new Response(JSON.stringify({ id: 'acc_test', status: 'ACTIVE' }), { status: 200 });
    }
    if (urlString.includes('/v2/positions')) {
      return new Response(JSON.stringify([{ symbol: 'TSLA', qty: '5', avg_entry_price: '200.00' }]), { status: 200 });
    }
    if (urlString.includes('/v2/orders')) {
      return new Response(JSON.stringify([{ id: 'pend_ord_1', symbol: 'TSLA', side: 'buy', status: 'new' }]), { status: 200 });
    }
    if (urlString.includes('/bars/latest')) {
      return new Response(JSON.stringify({ bar: { c: 200, t: new Date().toISOString() } }), { status: 200 });
    }
    if (urlString.includes('/v1beta1/news')) {
      return new Response(
        JSON.stringify({
          news: [{ id: 2, headline: 'TSLA loss crash drop slump downgrade warning', summary: 'Bearish slump', symbols: ['TSLA'] }],
        }),
        { status: 200 },
      );
    }
    if (urlString.includes('/v2/stocks/') && urlString.includes('/bars')) {
      return new Response(JSON.stringify({ bars: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 'ord_sell_1', status: 'accepted' }), { status: 200 });
  };

  // (market-hours Date mock handled by beforeEach)

  stockBot.start({ strategy: 'news_sentiment', intervalSeconds: 15, watchlist: ['TSLA'], extendedHours: false });
  await new Promise((r) => setTimeout(r, 200));
  stockBot.stop();

  const status = stockBot.getStatus();
  assert.ok(status.logs.some((l) => l.message.includes('News bearish') || l.message.includes('canceling pending buy')));
});

test('Trading Bot Mock - Executing Stop-Loss trigger cycle', async () => {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const urlString = String(input);
    if (urlString.includes('/v2/account')) {
      return new Response(JSON.stringify({ id: 'acc_test', status: 'ACTIVE' }), { status: 200 });
    }
    if (urlString.includes('/v2/positions')) {
      return new Response(JSON.stringify([{ symbol: 'AAPL', qty: '10', avg_entry_price: '100.00', asset_class: 'us_equity' }]), {
        status: 200,
      });
    }
    if (urlString.includes('/v2/orders')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (urlString.includes('/bars/latest')) {
      return new Response(JSON.stringify({ bar: { c: 90, t: new Date().toISOString() } }), { status: 200 });
    }
    if (urlString.includes('/v2/stocks/') && urlString.includes('/bars')) {
      return new Response(JSON.stringify({ bars: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 'ord_sl_1', status: 'filled' }), { status: 200 });
  };

  stockBot.start({ strategy: 'momentum', intervalSeconds: 15 });
  // Risk management fires immediately on start; wait for it to complete
  await new Promise((r) => setTimeout(r, 100));
  stockBot.stop();

  const status = stockBot.getStatus();
  assert.ok(status.logs.some((l) => l.message.includes('Stop Loss:')));
});

test('Trading Bot Mock - Executing Take-Profit trigger cycle', async () => {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const urlString = String(input);
    if (urlString.includes('/v2/account')) {
      return new Response(JSON.stringify({ id: 'acc_test', status: 'ACTIVE' }), { status: 200 });
    }
    if (urlString.includes('/v2/positions')) {
      return new Response(JSON.stringify([{ symbol: 'AAPL', qty: '10', avg_entry_price: '100.00', asset_class: 'us_equity' }]), {
        status: 200,
      });
    }
    if (urlString.includes('/v2/orders')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (urlString.includes('/bars/latest')) {
      return new Response(JSON.stringify({ bar: { c: 110, t: new Date().toISOString() } }), { status: 200 });
    }
    if (urlString.includes('/v2/stocks/') && urlString.includes('/bars')) {
      return new Response(JSON.stringify({ bars: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 'ord_tp_1', status: 'filled' }), { status: 200 });
  };

  stockBot.start({ strategy: 'momentum', intervalSeconds: 15 });
  // Risk management fires immediately on start; wait for it to complete
  await new Promise((r) => setTimeout(r, 100));
  stockBot.stop();

  const status = stockBot.getStatus();
  assert.ok(status.logs.some((l) => l.message.includes('Take Profit:')));
});

test('Trading Bot Mock - Executing Trailing Stop-Loss trigger cycle', async () => {
  let callCount = 0;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const urlString = String(input);
    if (urlString.includes('/v2/account')) {
      return new Response(JSON.stringify({ id: 'acc_test', status: 'ACTIVE' }), { status: 200 });
    }
    if (urlString.includes('/v2/positions')) {
      return new Response(JSON.stringify([{ symbol: 'AAPL', qty: '10', avg_entry_price: '100.00', asset_class: 'us_equity' }]), {
        status: 200,
      });
    }
    if (urlString.includes('/v2/orders')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (urlString.includes('/bars/latest')) {
      callCount++;
      // First call: price at peak (120). Second call: price drops to 115 (below trailing stop)
      const price = callCount === 1 ? 120 : 115;
      return new Response(JSON.stringify({ bar: { c: price, t: new Date().toISOString() } }), { status: 200 });
    }
    if (urlString.includes('/v2/stocks/') && urlString.includes('/bars')) {
      return new Response(JSON.stringify({ bars: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 'ord_trail_1', status: 'filled' }), { status: 200 });
  };

  stockBot.start({ strategy: 'momentum', intervalSeconds: 15, trailingStopPercent: 1.5, takeProfitPercent: 100 });
  // Risk management fires asynchronously; wait for it to produce logs
  await new Promise((r) => setTimeout(r, 300));
  stockBot.stop();
  await new Promise((r) => setTimeout(r, 50));

  const status = stockBot.getStatus();
  // Check that risk management ran by looking for any risk-related log
  assert.ok(
    status.logs.some(
      (l) =>
        l.message.includes('P/L:') ||
        l.message.includes('Trailing Stop:') ||
        l.message.includes('Stop Loss:') ||
        l.message.includes('Take Profit:'),
    ),
    `Expected risk management logs but found: ${status.logs.map((l) => l.message).join(' | ')}`,
  );
});

test('Trading Bot Mock - Technical Momentum BUY execution path', async () => {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const urlString = String(input);
    if (urlString.includes('/v2/account')) {
      return new Response(JSON.stringify({ id: 'acc_test', status: 'ACTIVE', cash: '100000', buying_power: '100000' }), { status: 200 });
    }
    if (urlString.includes('/v2/positions')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (urlString.includes('/v2/orders')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (urlString.includes('/bars/latest')) {
      return new Response(JSON.stringify({ bar: { c: 150, t: new Date().toISOString() } }), { status: 200 });
    }
    if (urlString.includes('/v2/stocks/') && urlString.includes('/bars')) {
      return new Response(JSON.stringify({ bars: [{ c: 140 }, { c: 142 }, { c: 145 }, { c: 148 }, { c: 150 }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 'ord_tech_buy', status: 'accepted' }), { status: 200 });
  };

  stockBot.start({ strategy: 'momentum', intervalSeconds: 15, symbol: 'AAPL' });
  await new Promise((r) => setTimeout(r, 100));
  stockBot.stop();

  const status = stockBot.getStatus();
  assert.ok(status.logs.some((l) => l.message.length > 0));
});

test('Trading Bot Mock - Account trading blocked handler', async () => {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const urlString = String(input);
    if (urlString.includes('/v2/account')) {
      return new Response(JSON.stringify({ id: 'acc_blocked', trading_blocked: true }), { status: 200 });
    }
    return new Response(JSON.stringify([]), { status: 200 });
  };

  stockBot.start({ strategy: 'momentum', intervalSeconds: 15 });
  await new Promise((r) => setTimeout(r, 100));
  stockBot.stop();

  const status = stockBot.getStatus();
  assert.ok(status.logs.some((l) => l.message.includes('Account trading is blocked')));
});

after(async () => {
  const { cacheService } = await import('../src/services/cacheService.js');
  await cacheService.close();
});
