import { Router, type Request, type Response } from 'express';

import { config } from '../config/alpaca.js';
import { database } from '../db/database.js';
import { alpacaService } from '../services/alpacaService.js';
import { Logger } from '../services/logger.js';
import { portfolioService } from '../services/portfolioService.js';

import { sendError } from './http.js';

export function createAccountRouter(): Router {
  const router = Router();

  router.get('/mode', (_request: Request, response: Response): void => {
    const mode = config.getAccountMode();
    const creds = config.getAlpacaCredentials();
    response.json({ mode, baseUrl: creds.baseUrl });
  });

  router.post('/mode', (request: Request, response: Response): void => {
    const { mode } = request.body;
    if (mode !== 'paper' && mode !== 'live') {
      response.status(400).json({ error: 'Invalid mode. Must be "paper" or "live".' });
      return;
    }
    config.setAccountMode(mode);
    const creds = config.getAlpacaCredentials();
    Logger.info(`Account mode changed to ${String(mode).toUpperCase()}`);
    response.json({ success: true, mode, baseUrl: creds.baseUrl });
  });

  router.get('/account', async (_request: Request, response: Response): Promise<void> => {
    try {
      response.json(await portfolioService.getAccountSummary());
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post('/account/reset', async (_request: Request, response: Response): Promise<void> => {
    try {
      const account = await alpacaService.getAccount();
      const positions = await alpacaService.getPositions();
      const newStartingEquity = portfolioService.computeStartingEquity(account, positions);

      database.resetSession(config.getAccountMode(), newStartingEquity);
      response.json({ success: true, startingEquity: newStartingEquity.toFixed(2) });
    } catch (error) {
      sendError(response, error);
    }
  });

  router.get('/positions', async (_request: Request, response: Response): Promise<void> => {
    try {
      response.json(await alpacaService.getPositions());
    } catch (error) {
      sendError(response, error);
    }
  });

  router.get('/positions/closed', async (_request: Request, response: Response): Promise<void> => {
    try {
      response.json(await portfolioService.getRealizedPlBySymbol());
    } catch (error) {
      sendError(response, error);
    }
  });

  router.delete('/positions/:symbol', async (request: Request, response: Response): Promise<void> => {
    try {
      response.json(await alpacaService.closePosition(String(request.params.symbol)));
    } catch (error) {
      sendError(response, error);
    }
  });

  return router;
}
