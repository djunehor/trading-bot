import ioredis from 'ioredis';
import dotenv from 'dotenv';
import { createLogger } from './logger.js';
dotenv.config();

const RedisConstructor = (ioredis as any).default || ioredis;

const log = createLogger('CacheService');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

let isRedisConnected = false;
let redisClient: any = null;

// In-Memory Fallback Cache (used if Redis is offline or in test mode)
const memoryFallbackCache = new Map<string, { value: any; expiresAt: number }>();

if (process.env.NODE_ENV !== 'test') {
  try {
    redisClient = new RedisConstructor(REDIS_URL, {
      maxRetriesPerRequest: 3,
      connectTimeout: 5000,
      retryStrategy(times: number) {
        if (times > 3) return null; // stop retrying
        return Math.min(times * 500, 3000);
      },
    });

    redisClient.on('connect', () => {
      isRedisConnected = true;
      log.info('Connected to Redis server successfully.');
    });

    redisClient.on('error', () => {
      isRedisConnected = false;
    });

    redisClient.on('ready', () => {
      isRedisConnected = true;
    });
  } catch (err: any) {
    isRedisConnected = false;
    log.warn('Redis initialization failed. Using in-memory fallback cache.');
  }
}

export async function getCache<T>(key: string): Promise<T | null> {
  const prefixedKey = `trading:${key}`;

  if (isRedisConnected && redisClient) {
    try {
      const data = await redisClient.get(prefixedKey);
      if (data) {
        return JSON.parse(data) as T;
      }
    } catch (err: any) {
      // Fall through to memory fallback
    }
  }

  // Check In-Memory Fallback Cache
  const memoryItem = memoryFallbackCache.get(prefixedKey);
  if (memoryItem) {
    if (Date.now() < memoryItem.expiresAt) {
      return memoryItem.value as T;
    } else {
      memoryFallbackCache.delete(prefixedKey);
    }
  }

  return null;
}

export async function setCache<T>(key: string, data: T, ttlSeconds: number = 60): Promise<void> {
  const prefixedKey = `trading:${key}`;
  const serialized = JSON.stringify(data);

  if (isRedisConnected && redisClient) {
    try {
      await redisClient.set(prefixedKey, serialized, 'EX', ttlSeconds);
    } catch (err: any) {
      // Fall through to memory set
    }
  }

  memoryFallbackCache.set(prefixedKey, {
    value: data,
    expiresAt: Date.now() + (ttlSeconds * 1000)
  });
}

export async function delCache(key: string): Promise<void> {
  const prefixedKey = `trading:${key}`;

  if (isRedisConnected && redisClient) {
    try {
      await redisClient.del(prefixedKey);
    } catch (err: any) {
      // Ignore
    }
  }

  memoryFallbackCache.delete(prefixedKey);
}

export async function clearAllCache(): Promise<void> {
  memoryFallbackCache.clear();
  if (isRedisConnected && redisClient) {
    try {
      await redisClient.flushdb();
    } catch (err: any) {
      // Ignore
    }
  }
}

export function isRedisActive(): boolean {
  return isRedisConnected;
}
