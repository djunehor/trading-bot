import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

import { getCache, setCache, delCache, clearAllCache, isRedisActive } from '../src/services/cacheService.js';

test('CacheService - setCache and getCache basic operations', async () => {
  await clearAllCache();
  const mockData = { symbol: 'AAPL', price: 185.50 };

  await setCache('test_key', mockData, 10);
  const retrieved = await getCache<typeof mockData>('test_key');

  assert.ok(retrieved);
  assert.equal(retrieved.symbol, 'AAPL');
  assert.equal(retrieved.price, 185.50);
});

test('CacheService - delCache operation', async () => {
  await setCache('del_key', { status: 'active' }, 10);
  let retrieved = await getCache('del_key');
  assert.ok(retrieved);

  await delCache('del_key');
  retrieved = await getCache('del_key');
  assert.equal(retrieved, null);
});

test('CacheService - Cache miss returns null', async () => {
  const result = await getCache('non_existent_key');
  assert.equal(result, null);
});

test('CacheService - isRedisActive status check', () => {
  const status = isRedisActive();
  assert.equal(typeof status, 'boolean');
});

test('CacheService - Expired memory cache returns null', async () => {
  await clearAllCache();
  await setCache('expiring_key', { foo: 'bar' }, 0.001); // 1 millisecond TTL
  await new Promise(r => setTimeout(r, 10));

  const result = await getCache('expiring_key');
  assert.equal(result, null);
});
