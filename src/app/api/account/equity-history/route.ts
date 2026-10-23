import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/app/api/helper';
import { config } from '@/config/alpaca';
import { database } from '@/db/database';

export async function GET(request: NextRequest) {
  try {
    const mode = config.getAccountMode();
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(Math.max(1, Number.parseInt(searchParams.get('limit') || '100', 10)), 300);
    const history = database.getEquitySnapshots(mode, limit);
    return jsonResponse(history);
  } catch (error) {
    return errorResponse(error);
  }
}
