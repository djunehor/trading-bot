import { jsonResponse, errorResponse } from '@/app/api/helper';
import { portfolioService } from '@/services/portfolioService';
import { config } from '@/config/alpaca';
import { getAppServices } from '@/services/context';

export async function GET() {
  try {
    const { env } = getAppServices();
    const mode = config.getAccountMode();
    const summary = await portfolioService.getAccountSummary();

    const cleanEquity = Number(summary.equity || 10000);
    const cleanChange = Number(summary.daily_change_pct || 0);

    const accounts = [
      {
        id: 'clean',
        name: 'Trading-bot',
        accountNumber: summary.account_number || 'PA3JYOC8B',
        subtitle: `Paper Account ${summary.account_number || 'PA3JYOC8B'}`,
        shortLabel: `Paper - ${summary.account_number || 'PA3JYOC8B'}`,
        equity: cleanEquity,
        changePct: cleanChange,
        mode,
      },
    ];

    if (env.ALPACA_RECOVERY_KEY_ID && env.ALPACA_RECOVERY_SECRET_KEY) {
      accounts.unshift({
        id: 'recovery',
        name: 'Paper Trading',
        accountNumber: 'PA336IFVN64F',
        subtitle: 'Paper Account PA336IFVN64F',
        shortLabel: 'Paper - PA336IFVN64F',
        equity: 87500.38,
        changePct: -1.99,
        mode: 'paper',
      });
    }

    return jsonResponse(accounts);
  } catch (error) {
    return errorResponse(error);
  }
}
