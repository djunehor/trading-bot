import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/app/api/helper';
import { alpacaService } from '@/services/alpacaService';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;
    const result = await alpacaService.closePosition(symbol);
    return jsonResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
