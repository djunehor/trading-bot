import { jsonResponse, errorResponse } from '@/app/api/helper';
import { portfolioService } from '@/services/portfolioService';

export async function GET() {
  try {
    const summary = await portfolioService.getAccountSummary();
    return jsonResponse(summary);
  } catch (error) {
    return errorResponse(error);
  }
}
