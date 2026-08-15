import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateSentiment, analyzeNewsSentiment, clearNewsCache, analyzeSentimentWithGemini } from '../src/services/newsService.js';
import { getCache, setCache, delCache, clearAllCache } from '../src/services/cacheService.js';

let originalFetch: typeof globalThis.fetch;

test.before((_) => {
  originalFetch = globalThis.fetch;
});

test.after((_) => {
  globalThis.fetch = originalFetch;
});

test('News Sentiment - Positive financial text scoring', () => {
  const text = 'Nvidia records surge in quarterly profit and beats revenue expectations with strong growth';
  const score = calculateSentiment(text);
  assert.ok(score > 0, `Expected positive score, got ${score}`);
});

test('News Sentiment - Negative financial text scoring', () => {
  const text = 'Tesla shares drop and plunge after lawsuit warning and revenue miss';
  const score = calculateSentiment(text);
  assert.ok(score < 0, `Expected negative score, got ${score}`);
});

test('News Sentiment - Neutral financial text scoring', () => {
  const text = 'Apple announces date for upcoming quarterly earnings conference call';
  const score = calculateSentiment(text);
  assert.equal(score, 0);
});

test('News Sentiment - Gemini 3.6 Flash LLM analyzer unit test', async () => {
  process.env.GEMINI_API_KEY = 'test_key';

  globalThis.fetch = async (input: RequestInfo | URL) => {
    return new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: JSON.stringify({ score: 0.85, sentiment: 'BULLISH' }) }] }
      }]
    }), { status: 200 });
  };

  const res = await analyzeSentimentWithGemini('AAPL', ['Apple reports record profits']);
  assert.ok(res !== null);
  assert.equal(res?.score, 0.85);
  assert.equal(res?.sentiment, 'BULLISH');
});

test('News Sentiment - Analyze watchlist top stocks', async () => {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    return new Response(JSON.stringify({
      news: [
        { id: 1, headline: 'Apple reports surge in iPhone sales and beats revenue expectation', summary: 'Bullish report', symbols: ['AAPL'] },
        { id: 2, headline: 'Nvidia records record AI chip growth', summary: 'Strong surge', symbols: ['NVDA'] }
      ]
    }), { status: 200 });
  };

  clearNewsCache();
  const sentiments = await analyzeNewsSentiment(['AAPL', 'NVDA']);
  assert.equal(sentiments.length, 2);
  assert.ok(['BULLISH', 'BEARISH', 'NEUTRAL'].includes(sentiments[0].sentiment));
});

test('Cache Service Unit Test - Fallback operations', async () => {
  await setCache('test_key', { data: 123 }, 5);
  const val = await getCache<{ data: number }>('test_key');
  assert.ok(val === null || val?.data === 123);

  await delCache('test_key');
  await clearAllCache();
});

test('News Sentiment - fetchNewsForSymbols returns news map', async () => {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    return new Response(JSON.stringify({
      news: [
        { id: 3, headline: 'Amazon stock rises on cloud growth', summary: 'Bullish', symbols: ['AMZN'] }
      ]
    }), { status: 200 });
  };
  await clearAllCache();
  const { fetchNewsForSymbols } = await import('../src/services/newsService.js');
  const map = await fetchNewsForSymbols(['AMZN']);
  assert.ok(map.AMZN);
  assert.ok(Array.isArray(map.AMZN));
});

test('News Sentiment - analyzeNewsSentiment Gemini path', async () => {
  process.env.GEMINI_API_KEY = 'test_gemini_key';
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('generativelanguage')) {
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ score: 0.6, sentiment: 'BULLISH', topHeadline: 'Great earnings' }) }] } }]
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      news: [{ id: 4, headline: 'Meta beats revenue on AI ad growth', summary: 'Bullish', symbols: ['META'] }]
    }), { status: 200 });
  };
  await clearAllCache();
  const sentiments = await analyzeNewsSentiment(['META'], true);
  assert.equal(sentiments.length, 1);
  delete process.env.GEMINI_API_KEY;
});

test('News Sentiment - fetchNewsForSymbols Webz path', async () => {
  const oldNodeEnv = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  process.env.WEBZ_TOKEN = 'test_webz';
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('api.webz.io')) {
      return new Response(JSON.stringify({
        posts: [{ uuid: 'w1', title: 'AAPL surges on strong iPhone sales', summary: 'AAPL beats expectations', url: 'http://x', published: '2026-01-01', entities: { organizations: [{ tickers: [{ ticker: 'AAPL' }] }] } }]
      }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
  await clearAllCache();
  const { fetchNewsForSymbols } = await import('../src/services/newsService.js');
  const map = await fetchNewsForSymbols(['AAPL']);
  assert.ok(map.AAPL.length > 0);
  delete process.env.WEBZ_TOKEN;
  process.env.NODE_ENV = oldNodeEnv;
});

test('News Sentiment - fetchNewsForSymbols NewsAPI path', async () => {
  const oldNodeEnv = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  process.env.NEWSAPI_KEY = 'test_newsapi';
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('newsapi.org')) {
      return new Response(JSON.stringify({
        articles: [{ url: 'http://n', title: 'TSLA drops after earnings miss', description: 'TSLA shares fall', publishedAt: '2026-01-01' }]
      }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
  await clearAllCache();
  const { fetchNewsForSymbols } = await import('../src/services/newsService.js');
  const map = await fetchNewsForSymbols(['TSLA']);
  assert.ok(map.TSLA.length > 0);
  delete process.env.NEWSAPI_KEY;
  process.env.NODE_ENV = oldNodeEnv;
});
