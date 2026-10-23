import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/app/api/helper';
import { alpacaService } from '@/services/alpacaService';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;
    const targetAccount = request.headers.get('x-target-account') || 'clean';
    const result = await alpacaService.closePosition(symbol, targetAccount);
    return jsonResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
