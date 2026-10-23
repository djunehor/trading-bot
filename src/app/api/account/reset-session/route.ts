import { jsonResponse, errorResponse } from '@/app/api/helper';
import { config } from '@/config/alpaca';
import { database } from '@/db/database';
import { alpacaService } from '@/services/alpacaService';
import { portfolioService } from '@/services/portfolioService';

export async function POST() {
  try {
    const account = await alpacaService.getAccount();
    const positions = await alpacaService.getPositions();
    const newStartingEquity = portfolioService.computeStartingEquity(account, positions);

    database.resetSession(config.getAccountMode(), newStartingEquity);
    return jsonResponse({ success: true, startingEquity: newStartingEquity.toFixed(2) });
  } catch (error) {
    return errorResponse(error);
  }
}
