import type { KVNamespace } from '@cloudflare/workers-types';
import type { ICache } from './cacheService.js';
import { Logger } from './logger.js';

export class KVCacheService implements ICache {
  private readonly memoryCache = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly kv: KVNamespace, private readonly prefix = 'trading') {}

  async get<T>(key: string): Promise<T | null> {
    const fullKey = `${this.prefix}:${key}`;
    const mem = this.memoryCache.get(fullKey);
    if (mem) {
      if (Date.now() <= mem.expiresAt) {
        try {
          return JSON.parse(mem.value) as T;
        } catch {
          // parse failed, fall through to KV
        }
      } else {
        this.memoryCache.delete(fullKey);
      }
    }

    try {
      const val = await this.kv.get<T>(fullKey, 'json');
      if (val !== null) {
        this.memoryCache.set(fullKey, {
          value: JSON.stringify(val),
          expiresAt: Date.now() + 60_000,
        });
      }
      return val;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds = 60): Promise<void> {
    const fullKey = `${this.prefix}:${key}`;
    const serialized = JSON.stringify(value);

    this.memoryCache.set(fullKey, {
      value: serialized,
      expiresAt: Date.now() + Math.max(0.001, ttlSeconds) * 1000,
    });

    // Cloudflare KV requires minimum expirationTtl of 60 seconds and free tier has 1,000 writes/day.
    // Skip KV writes for sub-minute caches (< 60s) to preserve quota.
    if (ttlSeconds < 60) {
      return;
    }

    try {
      const expirationTtl = Math.max(60, Math.floor(ttlSeconds));
      await this.kv.put(fullKey, serialized, { expirationTtl });
    } catch (err) {
      Logger.warn(`KV Cache set failed for key "${key}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async remove(key: string): Promise<void> {
    const fullKey = `${this.prefix}:${key}`;
    this.memoryCache.delete(fullKey);
    try {
      await this.kv.delete(fullKey);
    } catch (err) {
      Logger.warn(`KV Cache remove failed for key "${key}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async clearAll(): Promise<void> {
    this.memoryCache.clear();
    try {
      const list = await this.kv.list({ prefix: `${this.prefix}:` });
      for (const k of list.keys) {
        await this.kv.delete(k.name);
      }
    } catch (err) {
      Logger.warn(`KV Cache clearAll failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
