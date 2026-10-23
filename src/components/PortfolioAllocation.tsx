'use client';

import React from 'react';
import { PieChart } from 'lucide-react';

interface PortfolioAllocationProps {
  summary: {
    cash?: string | number;
    equity?: string | number;
    portfolio_value?: string | number;
  } | null;
  positions: Array<{ asset_class?: string; market_value?: string | number }>;
}

export function PortfolioAllocation({ summary, positions }: PortfolioAllocationProps) {
  const totalEquity = Math.max(1, Number(summary?.equity ?? summary?.portfolio_value ?? 0));
  const cash = Number(summary?.cash ?? 0);

  let stocksMv = 0;
  let cryptoMv = 0;

  for (const pos of positions) {
    const val = Number(pos.market_value || 0);
    if (pos.asset_class === 'crypto') {
      cryptoMv += val;
    } else {
      stocksMv += val;
    }
  }

  const cashPct = Math.min(100, Math.max(0, (cash / totalEquity) * 100));
  const stocksPct = Math.min(100, Math.max(0, (stocksMv / totalEquity) * 100));
  const cryptoPct = Math.min(100, Math.max(0, (cryptoMv / totalEquity) * 100));

  const fmt = (num: number) => num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm flex flex-col justify-between">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <PieChart className="w-4 h-4 text-emerald-400" />
          Asset Allocation
        </h3>
        <span className="text-xs text-muted font-mono font-medium">Total: ${fmt(totalEquity)}</span>
      </div>

      {/* Visual Multi-Color Bar */}
      <div className="w-full h-3.5 bg-background rounded-full overflow-hidden flex my-2 border border-card-border/80 p-0.5">
        <div style={{ width: `${cashPct}%` }} className="h-full bg-blue-500 rounded-l-full transition-all duration-500" title={`Cash: ${cashPct.toFixed(1)}%`} />
        <div style={{ width: `${stocksPct}%` }} className="h-full bg-emerald-500 transition-all duration-500" title={`Stocks: ${stocksPct.toFixed(1)}%`} />
        <div style={{ width: `${cryptoPct}%` }} className="h-full bg-yellow-500 rounded-r-full transition-all duration-500" title={`Crypto: ${cryptoPct.toFixed(1)}%`} />
      </div>

      {/* Metrics List */}
      <div className="grid grid-cols-3 gap-2 pt-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" />
          <div>
            <div className="text-muted text-[10px]">💵 Cash</div>
            <div className="font-semibold text-white font-mono">${fmt(cash)} ({cashPct.toFixed(1)}%)</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
          <div>
            <div className="text-muted text-[10px]">📈 Stocks</div>
            <div className="font-semibold text-white font-mono">${fmt(stocksMv)} ({stocksPct.toFixed(1)}%)</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-500 shrink-0" />
          <div>
            <div className="text-muted text-[10px]">🪙 Crypto</div>
            <div className="font-semibold text-white font-mono">${fmt(cryptoMv)} ({cryptoPct.toFixed(1)}%)</div>
          </div>
        </div>
      </div>
    </div>
  );
}
