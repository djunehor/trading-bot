-- Cloudflare D1 Migration: Cron Tick Lock Table

CREATE TABLE IF NOT EXISTS cron_locks (
  name TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
