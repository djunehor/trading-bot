import { NextResponse } from 'next/server';
import { getAppServices, type AppServices } from '@/services/context';
import { Logger } from '@/services/logger';

export function jsonResponse(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}

export function errorResponse(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : String(error);
  Logger.error(`API Error: ${message}`);
  return NextResponse.json({ error: message }, { status });
}

export function getServices(): AppServices {
  return getAppServices();
}
