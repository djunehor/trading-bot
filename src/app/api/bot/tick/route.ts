import { jsonResponse, errorResponse, getServices } from '@/app/api/helper';
import { runScheduledTick } from '@/services/scheduled';

export async function POST() {
  try {
    const { env } = getServices();
    await runScheduledTick(env);
    return jsonResponse({ success: true, message: 'Scheduled trading tick executed successfully.' });
  } catch (error) {
    return errorResponse(error);
  }
}
