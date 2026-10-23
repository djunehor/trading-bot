import { jsonResponse, errorResponse } from '@/app/api/helper';
import { portfolioService } from '@/services/portfolioService';

export async function GET() {
  try {
    const closed = await portfolioService.getRealizedPlBySymbol();
    return jsonResponse(closed);
  } catch (error) {
    return errorResponse(error);
  }
}
