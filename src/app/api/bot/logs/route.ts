import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/app/api/helper';
import { config } from '@/config/alpaca';
import { database } from '@/db/database';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('limit') || '50', 10)));
    const offset = (page - 1) * limit;
    const assetClass = searchParams.get('assetClass') || undefined;

    const paginatedLogs = database.getBotLogs(config.getAccountMode(), limit, offset, assetClass);
    return jsonResponse({
      logs: paginatedLogs.data,
      pagination: { page, limit, total: paginatedLogs.total, totalPages: Math.ceil(paginatedLogs.total / limit) },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
