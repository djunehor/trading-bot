import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/app/api/helper';
import { runBacktest, summarize, toIsoDay } from '@/services/backtestService';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, any>;
    const { symbols, start, end, initialCapital, positionSizePct } = body;
    if (!symbols || !start || !end) {
      return errorResponse(new Error('symbols, start, and end are required.'), 400);
    }

    const symbolList: string[] = Array.isArray(symbols)
      ? symbols.map(String)
      : String(symbols)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

    if (symbolList.length === 0) {
      return errorResponse(new Error('symbols must be a non-empty list.'), 400);
    }

    const capital = initialCapital !== undefined && !isNaN(Number(initialCapital))
      ? Math.max(10, Number(initialCapital))
      : undefined;

    const allocation = positionSizePct !== undefined && !isNaN(Number(positionSizePct))
      ? Math.min(1, Math.max(0.01, Number(positionSizePct) > 1 ? Number(positionSizePct) / 100 : Number(positionSizePct)))
      : undefined;

    const results = await runBacktest(symbolList, toIsoDay(String(start)), toIsoDay(String(end)), {
      startingCash: capital,
      positionSizePct: allocation,
    });
    return jsonResponse(summarize(results, capital));
  } catch (error) {
    return errorResponse(error);
  }
}
