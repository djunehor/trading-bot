import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/app/api/helper';
import { config } from '@/config/alpaca';
import { database } from '@/db/database';
import { alpacaService } from '@/services/alpacaService';
import { portfolioService } from '@/services/portfolioService';
import type { AlpacaOrder } from '@/types/alpaca';

export async function GET(request: NextRequest) {
  try {
    const targetAccount = request.headers.get('x-target-account') || 'clean';
    const searchParams = request.nextUrl.searchParams;
    const statusParameter = searchParams.get('status') || 'all';
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('limit') || '20', 10)));
    const offset = (page - 1) * limit;
    const sourceString = searchParams.get('source') || 'api';

    const mode = config.getAccountMode();
    const dbMode = `${mode}_${targetAccount}`;

    if (sourceString === 'db') {
      const paginated = database.getOrders(dbMode, limit, offset);
      return jsonResponse({
        orders: paginated.data,
        pagination: { page, limit, total: paginated.total, totalPages: Math.ceil(paginated.total / limit) },
      });
    }

    const orders = await alpacaService.getOrders(statusParameter, limit, targetAccount);
    const dbReasonMap = portfolioService.buildReasonMap(database.getOrders(dbMode, 500, 0).data);

    const enrichedOrders = orders.map((o: AlpacaOrder) => ({
      ...o,
      qty: o.qty == null ? (o.filled_qty == null ? o.notional || null : o.filled_qty) : o.qty,
      reason: dbReasonMap[o.id] || null,
    }));

    return jsonResponse({
      orders: enrichedOrders,
      pagination: { page, limit, total: enrichedOrders.length, totalPages: 1 },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const targetAccount = request.headers.get('x-target-account') || 'clean';
    const body = (await request.json()) as Record<string, any>;
    const { symbol, qty, side, type, limit_price, stop_price, extended_hours } = body;
    if (!symbol || !qty || !side) {
      return errorResponse(new Error('Missing required order fields: symbol, qty, side.'), 400);
    }
    const order = await alpacaService.createOrder(
      {
        symbol,
        qty: Number(qty),
        side,
        type,
        limit_price: limit_price ? Number(limit_price) : undefined,
        stop_price: stop_price ? Number(stop_price) : undefined,
        extended_hours: Boolean(extended_hours),
      },
      targetAccount,
    );
    return jsonResponse(order);
  } catch (error) {
    return errorResponse(error);
  }
}
