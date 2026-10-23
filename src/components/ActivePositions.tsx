'use client';

import React from 'react';
import { Layers, XCircle } from 'lucide-react';
import type { AlpacaPosition } from '@/types/alpaca';

interface ActivePositionsProps {
  positions: AlpacaPosition[];
  onClosePosition: (symbol: string) => void;
  isClosing: string | null;
}

export function ActivePositions({ positions, onClosePosition, isClosing }: ActivePositionsProps) {
  const fmt = (num: number) => num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Layers className="w-4 h-4 text-blue-400" />
          Active Positions ({positions.length})
        </h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-card-border/80 text-muted uppercase text-[10px] tracking-wider font-semibold">
              <th className="pb-3">Symbol</th>
              <th className="pb-3">Qty</th>
              <th className="pb-3">Current Price</th>
              <th className="pb-3">Entry Price</th>
              <th className="pb-3">Market Value</th>
              <th className="pb-3">Unrealized P/L</th>
              <th className="pb-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border/40 font-mono">
            {positions.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-muted font-sans">
                  No open positions currently held.
                </td>
              </tr>
            ) : (
              positions.map((pos) => {
                const qty = Number(pos.qty);
                const currentPrice = Number(pos.current_price);
                const avgEntry = Number(pos.avg_entry_price);
                const marketVal = Number(pos.market_value);
                const plDollars = Number(pos.unrealized_pl);
                const gainPct = Number(pos.unrealized_plpc) * 100;
                const isPositive = plDollars >= 0;

                return (
                  <tr key={pos.symbol} className="hover:bg-card-hover/40 transition-colors">
                    <td className="py-3 font-semibold text-white">
                      <div className="flex items-center gap-1.5">
                        <span>{pos.symbol}</span>
                        {pos.asset_class === 'crypto' && (
                          <span className="text-[9px] bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-1 py-0.2 rounded font-sans">
                            CRYPTO
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 text-slate-300">{qty}</td>
                    <td className="py-3 text-slate-300">${fmt(currentPrice)}</td>
                    <td className="py-3 text-slate-400">${fmt(avgEntry)}</td>
                    <td className="py-3 text-white font-medium">${fmt(marketVal)}</td>
                    <td className={`py-3 font-semibold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                      {isPositive ? '+' : ''}${fmt(plDollars)} ({isPositive ? '+' : ''}{gainPct.toFixed(2)}%)
                    </td>
                    <td className="py-3 text-right">
                      <button
                        onClick={() => onClosePosition(pos.symbol)}
                        disabled={isClosing === pos.symbol}
                        className="inline-flex items-center gap-1 text-[11px] font-sans font-medium px-2.5 py-1 rounded bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-500/20 transition-all disabled:opacity-50"
                      >
                        <XCircle className="w-3 h-3" />
                        {isClosing === pos.symbol ? 'Closing...' : 'Close'}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
