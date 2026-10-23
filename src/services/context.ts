import { getCloudflareContext } from '@opennextjs/cloudflare';
import { D1DatabaseService } from '../db/d1Database.js';
import type { CloudflareEnv } from '../types/cloudflare.js';
import { KVCacheService } from './kvCacheService.js';

export interface AppServices {
  env: CloudflareEnv;
  db: D1DatabaseService;
  cache: KVCacheService;
}

export function getAppServices(customEnv?: CloudflareEnv): AppServices {
  let env = customEnv;
  if (!env) {
    try {
      const ctx = getCloudflareContext();
      env = ctx.env as unknown as CloudflareEnv;
    } catch {
      // In local non-cloudflare environment fallback
      env = process.env as unknown as CloudflareEnv;
    }
  }

  const db = new D1DatabaseService(env.DB);
  const cache = new KVCacheService(env.TRADING_KV);

  return { env, db, cache };
}
