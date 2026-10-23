import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/app/api/helper';
import { BotManager } from '@/services/botManager';

export async function POST(request: NextRequest) {
  try {
    const body = ((await request.json().catch(() => ({}))) || {}) as Record<string, any>;
    const assetClass = body.assetClass || 'us_equity';
    const status = BotManager.stop(assetClass);
    return jsonResponse(status);
  } catch (error) {
    return errorResponse(error);
  }
}
