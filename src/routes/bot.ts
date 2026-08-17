import { Router, type Request, type Response } from 'express';

import { config } from '../config/alpaca.js';
import { database } from '../db/database.js';
import { alpacaService } from '../services/alpacaService.js';
import { BotManager } from '../services/botManager.js';
import { Logger } from '../services/logger.js';
import { portfolioService } from '../services/portfolioService.js';

import { sendError } from './http.js';

export function createBotRouter(): Router {
  const router = Router();

  router.get('/bot/status', (request: Request, response: Response): void => {
    const assetClass = typeof request.query.assetClass === 'string' ? (request.query.assetClass as 'crypto' | 'us_equity') : undefined;
    if (assetClass) {
      response.json(BotManager.getStatus(assetClass));
      return;
    }
    const stockStatus = BotManager.getStatus('us_equity');
    const cryptoStatus = BotManager.getStatus('crypto');
    response.json({ stockBot: stockStatus, cryptoBot: cryptoStatus, isRunning: stockStatus.isRunning || cryptoStatus.isRunning });
  });

  router.get('/bot/logs', (request: Request, response: Response): void => {
    const page = Math.max(1, Number.parseInt(typeof request.query.page === 'string' ? request.query.page : '1', 10));
    const limit = Math.min(100, Math.max(1, Number.parseInt(typeof request.query.limit === 'string' ? request.query.limit : '50', 10)));
    const offset = (page - 1) * limit;
    const assetClass = typeof request.query.assetClass === 'string' ? request.query.assetClass : undefined;
    const paginatedLogs = database.getBotLogs(config.getAccountMode(), limit, offset, assetClass);
    response.json({
      logs: paginatedLogs.data,
      pagination: { page, limit, total: paginatedLogs.total, totalPages: Math.ceil(paginatedLogs.total / limit) },
    });
  });

  router.post('/bot/start', async (request: Request, response: Response): Promise<void> => {
    try {
      const botConfig = request.body || {};
      const assetClass = botConfig.assetClass || 'us_equity';
      const account = await alpacaService.getAccount();
      const positions = await alpacaService.getPositions();
      const newStartingEquity = portfolioService.computeStartingEquity(account, positions);

      Logger.info(
        `[TradingBot] Resetting bot session baseline starting equity to $${newStartingEquity.toFixed(2)} on start (${assetClass}).`,
      );
      response.json(BotManager.start({ ...botConfig, assetClass }, newStartingEquity));
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post('/bot/stop', (request: Request, response: Response): void => {
    const assetClass = request.body?.assetClass || 'us_equity';
    response.json(BotManager.stop(assetClass));
  });

  return router;
}
