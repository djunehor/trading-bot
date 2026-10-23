import type { D1Database, KVNamespace } from '@cloudflare/workers-types';

export interface CloudflareEnv {
  DB: D1Database;
  TRADING_KV: KVNamespace;
  ALPACA_MODE?: string;
  ALPACA_PAPER_KEY_ID?: string;
  ALPACA_PAPER_SECRET_KEY?: string;
  ALPACA_LIVE_KEY_ID?: string;
  ALPACA_LIVE_SECRET_KEY?: string;
  ALPACA_RECOVERY_KEY_ID?: string;
  ALPACA_RECOVERY_SECRET_KEY?: string;
  AUTH_USERNAME?: string;
  AUTH_PASSWORD?: string;
  CRON_SECRET?: string;
  ENV_FILE?: string;
  PORT?: string | number;
}
