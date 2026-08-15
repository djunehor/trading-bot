import assert from 'assert';
import { getTopMovers } from '../src/services/alpacaService.js';
import { analyzeNewsSentiment } from '../src/services/newsService.js';

async function testDynamicDiscovery() {
  console.log('--- Testing Dynamic Stock Discovery Engine ---');

  const movers = await getTopMovers();
  console.log('Discovered Dynamic Market Movers:', movers);

  assert.ok(Array.isArray(movers), 'Movers is an array');
  assert.ok(movers.length > 0, 'Movers list is not empty');
  assert.ok(movers.includes('SPY'), 'Includes SPY index ETF');
  assert.ok(movers.includes('QQQ'), 'Includes QQQ index ETF');

  console.log('Testing analyzeNewsSentiment with dynamic discovery...');
  const sentiments = await analyzeNewsSentiment(undefined, false);
  console.log('Dynamic Sentiment Results count:', sentiments.length);
  assert.ok(sentiments.length > 0, 'Sentiment items returned');

  console.log('✅ Dynamic Stock Discovery Engine PASSED!');
  process.exit(0);
}

testDynamicDiscovery();
