import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/app/api/helper';
import { alpacaService } from '@/services/alpacaService';

export async function GET(request: NextRequest) {
  try {
    const targetAccount = request.headers.get('x-target-account') || 'clean';
    const positions = await alpacaService.getPositions(targetAccount);
    return jsonResponse(positions);
  } catch (error) {
    return errorResponse(error);
  }
}
