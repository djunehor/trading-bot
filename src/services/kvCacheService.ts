import type { KVNamespace } from '@cloudflare/workers-types';
import type { ICache } from './cacheService.js';
import { Logger } from './logger.js';

export class KVCacheService implements ICache {
  constructor(private readonly kv: KVNamespace, private readonly prefix = 'trading') {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const fullKey = `${this.prefix}:${key}`;
      return await this.kv.get<T>(fullKey, 'json');
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds = 60): Promise<void> {
    try {
      const fullKey = `${this.prefix}:${key}`;
      // Cloudflare KV requires minimum expirationTtl of 60 seconds
      const expirationTtl = Math.max(60, Math.floor(ttlSeconds));
      await this.kv.put(fullKey, JSON.stringify(value), { expirationTtl });
    } catch (err) {
      Logger.warn(`KV Cache set failed for key "${key}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      const fullKey = `${this.prefix}:${key}`;
      await this.kv.delete(fullKey);
    } catch (err) {
      Logger.warn(`KV Cache remove failed for key "${key}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async clearAll(): Promise<void> {
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
