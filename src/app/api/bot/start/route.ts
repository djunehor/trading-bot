import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/app/api/helper';
import { BotManager } from '@/services/botManager';
import { alpacaService } from '@/services/alpacaService';
import { portfolioService } from '@/services/portfolioService';
import { Logger } from '@/services/logger';

export async function POST(request: NextRequest) {
  try {
    const botConfig = ((await request.json().catch(() => ({}))) || {}) as Record<string, any>;
    const assetClass = botConfig.assetClass || 'us_equity';
    const account = await alpacaService.getAccount();
    const positions = await alpacaService.getPositions();
    const newStartingEquity = portfolioService.computeStartingEquity(account, positions);

    Logger.info(
      `[TradingBot] Resetting bot session baseline starting equity to $${newStartingEquity.toFixed(2)} on start (${assetClass}).`,
    );
    const status = BotManager.start({ ...botConfig, assetClass }, newStartingEquity);
    return jsonResponse(status);
  } catch (error) {
    return errorResponse(error);
  }
}
