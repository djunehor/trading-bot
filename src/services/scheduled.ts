import { getAppServices } from './context.js';
import { Logger } from './logger.js';
import { MarketClock } from './marketClock.js';
import { portfolioService } from './portfolioService.js';
import { BotEngine } from './tradingBot.js';
import { DEFAULT_CRYPTO_CONFIG, DEFAULT_STOCK_CONFIG } from './botConfig.js';
import type { CloudflareEnv } from '../types/cloudflare.js';

let isTickRunning = false;

export async function runScheduledTick(env: CloudflareEnv): Promise<void> {
  if (isTickRunning) {
    Logger.warn('[Cron] Scheduled tick skipped: prior tick still in flight.');
    return;
  }
  isTickRunning = true;

  const { db } = getAppServices(env);

  try {
    const accountsToProcess: Array<{ mode: 'paper' | 'live'; targetAccount?: 'clean' | 'recovery' }> = [];

    // Check account configuration
    const defaultMode = (env.ALPACA_MODE || 'paper').toLowerCase() as 'paper' | 'live';
    accountsToProcess.push({ mode: defaultMode, targetAccount: 'clean' });

    // If recovery keys are configured, process recovery account too
    if (env.ALPACA_RECOVERY_KEY_ID && env.ALPACA_RECOVERY_SECRET_KEY) {
      accountsToProcess.push({ mode: 'paper', targetAccount: 'recovery' });
    }

    const currentMinute = new Date().getMinutes();
    const isFiveMinuteMark = currentMinute % 5 === 0;

    for (const { mode } of accountsToProcess) {
      // Stock Bot execution
      const stockSaved = await db.getBotState(mode, 'us_equity');
      if (stockSaved.isRunning) {
        const stockConfig = stockSaved.config ? { ...DEFAULT_STOCK_CONFIG, ...stockSaved.config } : DEFAULT_STOCK_CONFIG;
        const stockBot = new BotEngine('us_equity', stockConfig, db as any);
        await stockBot.runRiskManagement();

        if (isFiveMinuteMark) {
          await stockBot.runStrategyCycle();
        }
      }

      // Crypto Bot execution
      const cryptoSaved = await db.getBotState(mode, 'crypto');
      if (cryptoSaved.isRunning) {
        const cryptoConfig = cryptoSaved.config ? { ...DEFAULT_CRYPTO_CONFIG, ...cryptoSaved.config } : DEFAULT_CRYPTO_CONFIG;
        const cryptoBot = new BotEngine('crypto', cryptoConfig, db as any);
        await cryptoBot.runRiskManagement();

        if (isFiveMinuteMark) {
          await cryptoBot.runStrategyCycle();
        }
      }

      // Equity Snapshot every 5 minutes
      if (isFiveMinuteMark) {
        try {
          await portfolioService.recordEquitySnapshot();
        } catch (snapshotErr) {
          Logger.warn(`[Cron] Equity snapshot failed for ${mode}: ${snapshotErr instanceof Error ? snapshotErr.message : String(snapshotErr)}`);
        }
      }
    }
  } catch (error) {
    Logger.error(`[Cron] Scheduled tick error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    isTickRunning = false;
  }
}
