import assert from 'node:assert/strict';
import test, { after } from 'node:test';

process.env.NODE_ENV = 'test';

import { cacheService } from '../src/services/cacheService.js';

test('CacheService - set and get basic operations', async () => {
  await cacheService.clearAll();
  const mockData = { symbol: 'AAPL', price: 185.5 };

  await cacheService.set('test_key', mockData, 10);
  const retrieved = await cacheService.get<typeof mockData>('test_key');

  assert.ok(retrieved);
  assert.equal(retrieved.symbol, 'AAPL');
  assert.equal(retrieved.price, 185.5);
});

test('CacheService - remove operation', async () => {
  await cacheService.set('del_key', { status: 'active' }, 10);
  let retrieved = await cacheService.get('del_key');
  assert.ok(retrieved);

  await cacheService.remove('del_key');
  retrieved = await cacheService.get('del_key');
  assert.equal(retrieved, null);
});

test('CacheService - Cache miss returns null', async () => {
  const result = await cacheService.get('non_existent_key');
  assert.equal(result, null);
});

test('CacheService - isRedisActive status check', () => {
  const isStatus = cacheService.isRedisActive();
  assert.equal(typeof isStatus, 'boolean');
});

test('CacheService - Expired memory cache returns null', async () => {
  await cacheService.clearAll();
  await cacheService.set('expiring_key', { foo: 'bar' }, 0.001); // 1 millisecond TTL
  await new Promise((r) => setTimeout(r, 10));

  const result = await cacheService.get('expiring_key');
  assert.equal(result, null);
});

after(async () => {
  const { cacheService } = await import('../src/services/cacheService.js');
  await cacheService.close();
});
