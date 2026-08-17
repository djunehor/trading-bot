import { Router, type Request, type Response } from 'express';

import { config } from '../config/alpaca.js';
import { database } from '../db/database.js';
import { MarketClock } from '../services/marketClock.js';
import { newsService } from '../services/newsService.js';

import { sendError } from './http.js';

export function createMarketRouter(): Router {
  const router = Router();

  router.get('/market/clock', (_request: Request, response: Response): void => {
    try {
      const status = MarketClock.getStatus();
      const countdownMs = Math.max(0, status.nextEventTime.getTime() - Date.now());

      response.json({
        isOpen: status.isOpen,
        marketStatus: status.marketStatus,
        nextEvent: status.nextEvent,
        nextEventTime: status.nextEventTime.toISOString(),
        countdown: {
          hours: Math.floor(countdownMs / (1000 * 60 * 60)),
          minutes: Math.floor((countdownMs % (1000 * 60 * 60)) / (1000 * 60)),
          seconds: Math.floor((countdownMs % (1000 * 60)) / 1000),
          totalMs: countdownMs,
        },
        serverTimestamp: new Date().toISOString(),
      });
    } catch (error) {
      sendError(response, error);
    }
  });

  router.get('/account/equity-history', (request: Request, response: Response): void => {
    const mode = config.getAccountMode();
    const limit = Math.min(Math.max(1, Number.parseInt(request.query.limit as string, 10) || 100), 300);
    response.json(database.getEquitySnapshots(mode, limit));
  });

  router.get('/news/sentiment', async (_request: Request, response: Response): Promise<void> => {
    try {
      response.json(await newsService.analyzeNewsSentiment(undefined, false));
    } catch (error) {
      sendError(response, error);
    }
  });

  return router;
}
