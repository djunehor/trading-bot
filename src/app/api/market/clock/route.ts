import { jsonResponse, errorResponse } from '@/app/api/helper';
import { MarketClock } from '@/services/marketClock';

export async function GET() {
  try {
    const status = MarketClock.getStatus();
    const countdownMs = Math.max(0, status.nextEventTime.getTime() - Date.now());

    return jsonResponse({
      isOpen: status.isOpen,
      marketStatus: status.marketStatus,
      nextEvent: status.nextEvent,
      nextEventTime: status.nextEventTime.toISOString(),
      countdown: {
        hours: Math.floor(countdownMs / (1000 * 60 * 60)),
        minutes: Math.floor((countdownMs % (1000 * 60 * 60)) / (1000 * 60)),
        seconds: Math.floor((countdownMs % (1000 * 60)) / 1000),
        totalMs: countdownMs,
      },
      serverTimestamp: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
