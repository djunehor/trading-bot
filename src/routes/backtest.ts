import { Router, type Request, type Response } from 'express';

import { runBacktest, summarize, toIsoDay } from '../services/backtestService.js';
import { sendError } from './http.js';

export function createBacktestRouter(): Router {
  const router = Router();

  router.post('/backtest', async (request: Request, response: Response): Promise<void> => {
    try {
      const { symbols, start, end, initialCapital, positionSizePct } = request.body;
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

      const capital = initialCapital !== undefined && !isNaN(Number(initialCapital))
        ? Math.max(10, Number(initialCapital))
        : undefined;

      const allocation = positionSizePct !== undefined && !isNaN(Number(positionSizePct))
        ? Math.min(1, Math.max(0.01, Number(positionSizePct) > 1 ? Number(positionSizePct) / 100 : Number(positionSizePct)))
        : undefined;

      const results = await runBacktest(symbolList, toIsoDay(String(start)), toIsoDay(String(end)), {
        startingCash: capital,
        positionSizePct: allocation,
      });
      response.json(summarize(results, capital));
    } catch (error) {
      sendError(response, error);
    }
  });

  return router;
}
