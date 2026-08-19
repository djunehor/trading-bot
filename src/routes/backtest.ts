import { Router, type Request, type Response } from 'express';

import { runBacktest, summarize, toIsoDay } from '../services/backtestService.js';
import { sendError } from './http.js';

export function createBacktestRouter(): Router {
  const router = Router();

  router.post('/backtest', async (request: Request, response: Response): Promise<void> => {
    try {
      const { symbols, start, end } = request.body;
      if (!symbols || !start || !end) {
        response.status(400).json({ error: 'symbols, start, and end are required.' });
        return;
      }

      const symbolList: string[] = Array.isArray(symbols)
        ? symbols.map(String)
        : String(symbols)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);

      if (symbolList.length === 0) {
        response.status(400).json({ error: 'symbols must be a non-empty list.' });
        return;
      }

      const results = await runBacktest(symbolList, toIsoDay(String(start)), toIsoDay(String(end)));
      response.json(summarize(results));
    } catch (error) {
      sendError(response, error);
    }
  });

  return router;
}
