import { jsonResponse, errorResponse } from '@/app/api/helper';
import { newsService } from '@/services/newsService';

export async function GET() {
  try {
    const sentiments = await newsService.analyzeNewsSentiment(undefined, false);
    return jsonResponse(sentiments);
  } catch (error) {
    return errorResponse(error);
  }
}
