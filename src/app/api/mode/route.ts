import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/app/api/helper';
import { config } from '@/config/alpaca';
import { alpacaService } from '@/services/alpacaService';

export async function GET() {
  try {
    const mode = config.getAccountMode();
    const creds = config.getAlpacaCredentials();
    return jsonResponse({
      mode,
      keyId: creds.keyId ? `${creds.keyId.slice(0, 4)}...` : 'not set',
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, any>;
    const newMode = config.setAccountMode(body.mode);
    await alpacaService.invalidateAllCaches();
    return jsonResponse({ mode: newMode, success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
