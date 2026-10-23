import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/app/api/helper';
import { BotManager } from '@/services/botManager';

export async function GET(request: NextRequest) {
  try {
    const assetClass = request.nextUrl.searchParams.get('assetClass') as 'crypto' | 'us_equity' | null;
    if (assetClass) {
      return jsonResponse(BotManager.getStatus(assetClass));
    }
    const stockStatus = BotManager.getStatus('us_equity');
    const cryptoStatus = BotManager.getStatus('crypto');
    return jsonResponse({
      stockBot: stockStatus,
      cryptoBot: cryptoStatus,
      isRunning: stockStatus.isRunning || cryptoStatus.isRunning,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
