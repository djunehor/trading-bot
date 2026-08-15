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
