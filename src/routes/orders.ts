import { Router, type Request, type Response } from 'express';

import { config } from '../config/alpaca.js';
import { database } from '../db/database.js';
import { alpacaService } from '../services/alpacaService.js';
import { portfolioService } from '../services/portfolioService.js';
import type { AlpacaOrder } from '../types/alpaca.js';

import { sendError } from './http.js';

export function createOrdersRouter(): Router {
  const router = Router();

  router.get('/orders', async (request: Request, response: Response): Promise<void> => {
    try {
      const statusParameter = typeof request.query.status === 'string' ? request.query.status : 'all';
      const page = Math.max(1, Number.parseInt(typeof request.query.page === 'string' ? request.query.page : '1', 10));
      const limit = Math.min(100, Math.max(1, Number.parseInt(typeof request.query.limit === 'string' ? request.query.limit : '20', 10)));
      const offset = (page - 1) * limit;
      const sourceString = typeof request.query.source === 'string' ? request.query.source : 'api';

      if (sourceString === 'db') {
        const paginated = database.getOrders(config.getAccountMode(), limit, offset);
        response.json({
          orders: paginated.data,
          pagination: { page, limit, total: paginated.total, totalPages: Math.ceil(paginated.total / limit) },
        });
        return;
      }

      const orders = await alpacaService.getOrders(statusParameter, limit);
      const dbReasonMap = portfolioService.buildReasonMap(database.getOrders(config.getAccountMode(), 500, 0).data);

      const enrichedOrders = orders.map((o: AlpacaOrder) => ({
        ...o,
        qty: o.qty == null ? (o.filled_qty == null ? o.notional || null : o.filled_qty) : o.qty,
        reason: dbReasonMap[o.id] || null,
      }));

      response.json({ orders: enrichedOrders, pagination: { page, limit, total: enrichedOrders.length, totalPages: 1 } });
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post('/orders', async (request: Request, response: Response): Promise<void> => {
    try {
      const { symbol, qty, side, type, limit_price, stop_price } = request.body;
      if (!symbol || !qty || !side) {
        response.status(400).json({ error: 'Missing required order fields: symbol, qty, side.' });
        return;
      }
      const order = await alpacaService.createOrder({
        symbol,
        qty: Number(qty),
        side,
        type,
        limit_price: limit_price ? Number(limit_price) : undefined,
        stop_price: stop_price ? Number(stop_price) : undefined,
      });
      response.json(order);
    } catch (error) {
      sendError(response, error);
    }
  });

  router.delete('/orders/:id', async (request: Request, response: Response): Promise<void> => {
    try {
      response.json(await alpacaService.cancelOrder(String(request.params.id)));
    } catch (error) {
      sendError(response, error);
    }
  });

  return router;
}
