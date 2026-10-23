import { jsonResponse, errorResponse } from '@/app/api/helper';
import { alpacaService } from '@/services/alpacaService';

export async function GET() {
  try {
    const positions = await alpacaService.getPositions();
    return jsonResponse(positions);
  } catch (error) {
    return errorResponse(error);
  }
}
