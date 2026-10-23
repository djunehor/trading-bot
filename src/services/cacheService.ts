import { Logger } from './logger.js';

export interface ICache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  remove(key: string): Promise<void>;
  clearAll(): Promise<void>;
}

interface MemoryCacheEntry {
  value: string;
  expiresAt: number;
}

export class CacheService implements ICache {
  private readonly memoryCache = new Map<string, MemoryCacheEntry>();
  private readonly prefix: string;

  constructor(options: { prefix?: string } = {}) {
    this.prefix = options.prefix || process.env.CACHE_PREFIX || 'trading';
  }

  private getKV(): any | null {
    try {
      const { getCloudflareContext } = require('@opennextjs/cloudflare');
      const ctx = getCloudflareContext();
      return ctx?.env?.TRADING_KV || null;
    } catch {
      return null;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const fullKey = `${this.prefix}:${key}`;
    const kv = this.getKV();
    if (kv) {
      try {
        return await kv.get(fullKey, 'json');
      } catch {
        return null;
      }
    }

    const entry = this.memoryCache.get(fullKey);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.memoryCache.delete(fullKey);
      return null;
    }
    try {
      return JSON.parse(entry.value) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds = 60): Promise<void> {
    const fullKey = `${this.prefix}:${key}`;
    const kv = this.getKV();
    if (kv) {
      try {
        const expirationTtl = Math.max(60, Math.floor(ttlSeconds));
        await kv.put(fullKey, JSON.stringify(value), { expirationTtl });
        return;
      } catch (err) {
        Logger.warn(`KV Cache set failed for key "${key}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.memoryCache.set(fullKey, {
      value: JSON.stringify(value),
      expiresAt: Date.now() + Math.max(1, ttlSeconds) * 1000,
    });
  }

  async remove(key: string): Promise<void> {
    const fullKey = `${this.prefix}:${key}`;
    const kv = this.getKV();
    if (kv) {
      try {
        await kv.delete(fullKey);
      } catch (err) {
        Logger.warn(`KV Cache remove failed for key "${key}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.memoryCache.delete(fullKey);
  }

  async clearAll(): Promise<void> {
    const kv = this.getKV();
    if (kv) {
      try {
        const list = await kv.list({ prefix: `${this.prefix}:` });
        for (const k of list.keys) {
          await kv.delete(k.name);
        }
      } catch (err) {
        Logger.warn(`KV Cache clearAll failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.memoryCache.clear();
  }

  async close(): Promise<void> {}
}

export const cacheService = new CacheService();
