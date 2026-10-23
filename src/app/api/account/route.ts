import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/app/api/helper';
import { portfolioService } from '@/services/portfolioService';

export async function GET(request: NextRequest) {
  try {
    const targetAccount = request.headers.get('x-target-account') || 'clean';
    const summary = await portfolioService.getAccountSummary(targetAccount);
    return jsonResponse(summary);
  } catch (error) {
    return errorResponse(error);
  }
}
