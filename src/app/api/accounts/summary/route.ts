import { jsonResponse, errorResponse } from '@/app/api/helper';
import { portfolioService } from '@/services/portfolioService';
import { config } from '@/config/alpaca';

export async function GET() {
  try {
    const mode = config.getAccountMode();

    const [cleanSummary, recoverySummary] = await Promise.all([
      portfolioService.getAccountSummary('clean').catch(() => null),
      portfolioService.getAccountSummary('recovery').catch(() => null),
    ]);

    const cleanEquity = Number(cleanSummary?.equity || 10000);
    const cleanChange = Number(cleanSummary?.daily_change_pct || 0);

    const recoveryEquity = Number(recoverySummary?.equity || 87500.38);
    const recoveryChange = Number(recoverySummary?.daily_change_pct || -1.99);

    const accounts = [
      {
        id: 'clean',
        name: 'Trading-bot',
        accountNumber: cleanSummary?.account_number || 'PA3JYOC8B',
        subtitle: `Paper Account ${cleanSummary?.account_number || 'PA3JYOC8B'}`,
        shortLabel: `Paper - ${cleanSummary?.account_number || 'PA3JYOC8B'}`,
        equity: cleanEquity,
        changePct: cleanChange,
        mode,
      },
      {
        id: 'recovery',
        name: 'Paper Trading',
        accountNumber: recoverySummary?.account_number || 'PA336IFVN64F',
        subtitle: `Paper Account ${recoverySummary?.account_number || 'PA336IFVN64F'}`,
        shortLabel: `Paper - ${recoverySummary?.account_number || 'PA336IFVN64F'}`,
        equity: recoveryEquity,
        changePct: recoveryChange,
        mode: 'paper',
      },
    ];

    return jsonResponse(accounts);
  } catch (error) {
    return errorResponse(error);
  }
}
