'use client';

import React, { useState } from 'react';
import { History, Play, BarChart2 } from 'lucide-react';

interface BacktestSummary {
  startingCash?: number;
  endingCash?: number;
  totalProfit?: number;
  totalProfitPct?: number;
  totalTrades?: number;
  winRate?: number;
  maxDrawdownPct?: number;
  trades?: Array<{
    symbol: string;
    entryTime: string;
    exitTime: string;
    entryPrice: number;
    exitPrice: number;
    qty: number;
    profit: number;
    profitPct: number;
    reason: string;
  }>;
}

export function Backtester() {
  const [symbols, setSymbols] = useState('AAPL, NVDA, SPY');
  const [start, setStart] = useState('2024-01-01');
  const [end, setEnd] = useState(new Date().toISOString().slice(0, 10));
  const [initialCapital, setInitialCapital] = useState('10000');
  const [positionSizePct, setPositionSizePct] = useState('10');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestSummary | null>(null);

  const handleRunBacktest = async (e: React.FormEvent) => {
    e.preventDefault();
    setRunning(true);
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbols,
          start,
          end,
          initialCapital: Number(initialCapital),
          positionSizePct: Number(positionSizePct),
        }),
      });
      if (res.ok) {
        setResult(await res.json());
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <History className="w-4 h-4 text-purple-400" />
            Strategy Historical Backtester
          </h3>
          <p className="text-[11px] text-muted">Test VWAP + RSI Momentum Strategy against historical Alpaca bars</p>
        </div>
      </div>

      <form onSubmit={handleRunBacktest} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-5 text-xs">
        <div>
          <label className="text-muted font-medium block mb-1">Symbols</label>
          <input
            type="text"
            value={symbols}
            onChange={(e) => setSymbols(e.target.value)}
            className="w-full bg-background border border-card-border rounded-lg px-2.5 py-1.5 text-white font-mono"
            required
          />
        </div>

        <div>
          <label className="text-muted font-medium block mb-1">Start Date</label>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="w-full bg-background border border-card-border rounded-lg px-2.5 py-1.5 text-white"
            required
          />
        </div>

        <div>
          <label className="text-muted font-medium block mb-1">End Date</label>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="w-full bg-background border border-card-border rounded-lg px-2.5 py-1.5 text-white"
            required
          />
        </div>

        <div>
          <label className="text-muted font-medium block mb-1">Initial Capital ($)</label>
          <input
            type="number"
            value={initialCapital}
            onChange={(e) => setInitialCapital(e.target.value)}
            className="w-full bg-background border border-card-border rounded-lg px-2.5 py-1.5 text-white font-mono"
            required
          />
        </div>

        <div className="flex items-end">
          <button
            type="submit"
            disabled={running}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold transition-all disabled:opacity-50"
          >
            <Play className={`w-3.5 h-3.5 ${running ? 'animate-spin' : ''}`} />
            {running ? 'Simulating...' : 'Run Backtest'}
          </button>
        </div>
      </form>

      {/* Backtest Results */}
      {result && (
        <div className="bg-background/60 border border-card-border rounded-xl p-4 mt-4 font-mono text-xs">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
            <div>
              <div className="text-muted text-[10px] font-sans">Ending Equity</div>
              <div className="font-bold text-white text-sm">
                ${Number(result.endingCash || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div>
              <div className="text-muted text-[10px] font-sans">Net Profit</div>
              <div className={`font-bold text-sm ${Number(result.totalProfit || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {Number(result.totalProfit || 0) >= 0 ? '+' : ''}${Number(result.totalProfit || 0).toFixed(2)} ({Number(result.totalProfitPct || 0).toFixed(2)}%)
              </div>
            </div>
            <div>
              <div className="text-muted text-[10px] font-sans">Total Trades</div>
              <div className="font-bold text-white text-sm">{result.totalTrades || 0}</div>
            </div>
            <div>
              <div className="text-muted text-[10px] font-sans">Win Rate</div>
              <div className="font-bold text-white text-sm">{Number(result.winRate || 0).toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-muted text-[10px] font-sans">Max Drawdown</div>
              <div className="font-bold text-red-400 text-sm">-{Number(result.maxDrawdownPct || 0).toFixed(2)}%</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
