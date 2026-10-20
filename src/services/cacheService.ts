import dotenv from 'dotenv';
import { Redis } from 'ioredis';

import { Logger } from './logger.js';

dotenv.config({ path: process.env.ENV_FILE || undefined });

export interface ICache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  remove(key: string): Promise<void>;
  clearAll(): Promise<void>;
}

export class CacheService implements ICache {
  private readonly redis: Redis;

  constructor(options: { url?: string } = {}) {
    const url = options.url || process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    this.redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      connectTimeout: 5000,
      retryStrategy(times: number) {
        if (times > 3) {
          return null;
        } // stop retrying
        return Math.min(times * 500, 3000);
      },
    });

    this.redis.on('error', () => {});
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(this.prefixed(key));
      return value ? (JSON.parse(value) as T) : null;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds = 60): Promise<void> {
    try {
      await this.redis.set(this.prefixed(key), JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      Logger.warn(`Cache set failed for key "${key}".`);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await this.redis.del(this.prefixed(key));
    } catch {
      Logger.warn(`Cache remove failed for key "${key}".`);
    }
  }

  async clearAll(): Promise<void> {
    try {
      const prefix = process.env.CACHE_PREFIX || 'trading';
      const keys = await this.redis.keys(`${prefix}:*`);
      if (keys.length > 0) {
        await this.redis.del(keys);
      }
    } catch {
      Logger.warn('Cache clearAll failed.');
    }
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }

  isRedisActive(): boolean {
    return this.redis.status === 'ready';
  }

  private prefixed(key: string): string {
    const prefix = process.env.CACHE_PREFIX || 'trading';
    return `${prefix}:${key}`;
  }
}

export const cacheService = new CacheService();
