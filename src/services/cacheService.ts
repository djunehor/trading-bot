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

  isRedisActive(): boolean {
    return false;
  }

  async get<T>(key: string): Promise<T | null> {
    const fullKey = `${this.prefix}:${key}`;

    // L1: Check in-memory cache first to avoid unnecessary KV reads
    const entry = this.memoryCache.get(fullKey);
    if (entry) {
      if (Date.now() <= entry.expiresAt) {
        try {
          return JSON.parse(entry.value) as T;
        } catch {
          // parse failed, fall through to KV
        }
      } else {
        this.memoryCache.delete(fullKey);
      }
    }

    // L2: Fallback to Cloudflare KV if available
    const kv = this.getKV();
    if (kv) {
      try {
        const val = await kv.get(fullKey, 'json');
        if (val !== null) {
          this.memoryCache.set(fullKey, {
            value: JSON.stringify(val),
            expiresAt: Date.now() + 60_000,
          });
        }
        return val as T;
      } catch {
        return null;
      }
    }

    return null;
  }

  async set<T>(key: string, value: T, ttlSeconds = 60): Promise<void> {
    const fullKey = `${this.prefix}:${key}`;
    const serialized = JSON.stringify(value);

    // Always populate L1 memory cache
    this.memoryCache.set(fullKey, {
      value: serialized,
      expiresAt: Date.now() + Math.max(0.001, ttlSeconds) * 1000,
    });

    // Cloudflare KV requires minimum expirationTtl of 60 seconds and free tier has strict write limits (1,000/day).
    // Ephemeral / short-lived items (< 60s) should stay purely in-memory.
    if (ttlSeconds < 60) {
      return;
    }

    const kv = this.getKV();
    if (kv) {
      try {
        const expirationTtl = Math.max(60, Math.floor(ttlSeconds));
        await kv.put(fullKey, serialized, { expirationTtl });
      } catch (err) {
        Logger.warn(`KV Cache set failed for key "${key}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  async remove(key: string): Promise<void> {
    const fullKey = `${this.prefix}:${key}`;
    this.memoryCache.delete(fullKey);

    const kv = this.getKV();
    if (kv) {
      try {
        await kv.delete(fullKey);
      } catch (err) {
        Logger.warn(`KV Cache remove failed for key "${key}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  async clearAll(): Promise<void> {
    this.memoryCache.clear();

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
  }

  async close(): Promise<void> {}
}

export const cacheService = new CacheService();
