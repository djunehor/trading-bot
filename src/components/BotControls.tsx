'use client';

import React, { useState } from 'react';
import { Play, Square, Settings, Bot, ShieldCheck } from 'lucide-react';

interface BotConfigData {
  strategy?: string;
  intervalSeconds?: number;
  stopLossPercent?: number;
  takeProfitPercent?: number;
  trailingStopPercent?: number;
  watchlist?: string[];
}

interface BotStatusItem {
  isRunning: boolean;
  config: BotConfigData;
}

interface BotControlsProps {
  stockBot: BotStatusItem | null;
  cryptoBot: BotStatusItem | null;
  onStartBot: (assetClass: 'us_equity' | 'crypto', config?: Partial<BotConfigData>) => void;
  onStopBot: (assetClass: 'us_equity' | 'crypto') => void;
}

export function BotControls({ stockBot, cryptoBot, onStartBot, onStopBot }: BotControlsProps) {
  const [stockInterval, setStockInterval] = useState('300');
  const [stockStopLoss, setStockStopLoss] = useState('2.5');
  const [stockTakeProfit, setStockTakeProfit] = useState('4.0');
  const [stockTrailingStop, setStockTrailingStop] = useState('1.5');

  const isStockRunning = stockBot?.isRunning ?? false;
  const isCryptoRunning = cryptoBot?.isRunning ?? false;

  const handleStartStock = () => {
    onStartBot('us_equity', {
      intervalSeconds: Number(stockInterval),
      stopLossPercent: Number(stockStopLoss),
      takeProfitPercent: Number(stockTakeProfit),
      trailingStopPercent: Number(stockTrailingStop),
    });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Stock Trading Bot Card */}
      <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center font-bold">
                📈
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Automated Stock Bot</h3>
                <p className="text-[11px] text-muted">US Equities Momentum & Sentiment</p>
              </div>
            </div>
            <span
              className={`text-xs px-2.5 py-0.5 rounded-full font-semibold border ${
                isStockRunning
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : 'bg-slate-500/10 text-slate-400 border-slate-500/30'
              }`}
            >
              {isStockRunning ? 'RUNNING' : 'STOPPED'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="text-[10px] text-muted font-medium block mb-1">Cycle Interval</label>
              <select
                value={stockInterval}
                onChange={(e) => setStockInterval(e.target.value)}
                disabled={isStockRunning}
                className="w-full bg-background border border-card-border rounded-lg px-2.5 py-1.5 text-xs text-white disabled:opacity-50"
              >
                <option value="60">1 Minute</option>
                <option value="300">5 Minutes (Default)</option>
                <option value="900">15 Minutes</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] text-muted font-medium block mb-1">Stop Loss %</label>
              <input
                type="number"
                step="0.1"
                value={stockStopLoss}
                onChange={(e) => setStockStopLoss(e.target.value)}
                disabled={isStockRunning}
                className="w-full bg-background border border-card-border rounded-lg px-2.5 py-1.5 text-xs text-white disabled:opacity-50"
              />
            </div>

            <div>
              <label className="text-[10px] text-muted font-medium block mb-1">Take Profit %</label>
              <input
                type="number"
                step="0.1"
                value={stockTakeProfit}
                onChange={(e) => setStockTakeProfit(e.target.value)}
                disabled={isStockRunning}
                className="w-full bg-background border border-card-border rounded-lg px-2.5 py-1.5 text-xs text-white disabled:opacity-50"
              />
            </div>

            <div>
              <label className="text-[10px] text-muted font-medium block mb-1">Trailing Stop %</label>
              <input
                type="number"
                step="0.1"
                value={stockTrailingStop}
                onChange={(e) => setStockTrailingStop(e.target.value)}
                disabled={isStockRunning}
                className="w-full bg-background border border-card-border rounded-lg px-2.5 py-1.5 text-xs text-white disabled:opacity-50"
              />
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-card-border/60 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] text-muted">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Risk Check: 30s &bull; SPY Regime Guard</span>
          </div>
          {isStockRunning ? (
            <button
              onClick={() => onStopBot('us_equity')}
              className="flex items-center gap-1.5 text-xs font-semibold px-4 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 transition-all"
            >
              <Square className="w-3.5 h-3.5" />
              Stop Bot
            </button>
          ) : (
            <button
              onClick={handleStartStock}
              className="flex items-center gap-1.5 text-xs font-semibold px-4 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 transition-all"
            >
              <Play className="w-3.5 h-3.5" />
              Start Bot
            </button>
          )}
        </div>
      </div>

      {/* Crypto Trading Bot Card */}
      <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 flex items-center justify-center font-bold">
                🪙
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Automated Crypto Bot</h3>
                <p className="text-[11px] text-muted">24/7 Digital Assets (Sell-Only Protection)</p>
              </div>
            </div>
            <span
              className={`text-xs px-2.5 py-0.5 rounded-full font-semibold border ${
                isCryptoRunning
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : 'bg-slate-500/10 text-slate-400 border-slate-500/30'
              }`}
            >
              {isCryptoRunning ? 'RUNNING' : 'STOPPED'}
            </span>
          </div>

          <div className="bg-background/40 border border-card-border/60 rounded-xl p-3 text-xs text-muted mb-4 space-y-1.5">
            <div className="flex justify-between">
              <span>Execution Strategy:</span>
              <span className="text-white font-medium">Momentum + VWAP</span>
            </div>
            <div className="flex justify-between">
              <span>Allowed Assets:</span>
              <span className="text-white font-medium">BTC/USD, ETH/USD, SOL/USD</span>
            </div>
            <div className="flex justify-between">
              <span>Risk Policy:</span>
              <span className="text-yellow-400 font-medium">Sell-Only (Exit Protection)</span>
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-card-border/60 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] text-muted">
            <Bot className="w-3.5 h-3.5 text-blue-400" />
            <span>24/7 Execution on Cloudflare Cron</span>
          </div>
          {isCryptoRunning ? (
            <button
              onClick={() => onStopBot('crypto')}
              className="flex items-center gap-1.5 text-xs font-semibold px-4 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 transition-all"
            >
              <Square className="w-3.5 h-3.5" />
              Stop Bot
            </button>
          ) : (
            <button
              onClick={() => onStartBot('crypto')}
              className="flex items-center gap-1.5 text-xs font-semibold px-4 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 transition-all"
            >
              <Play className="w-3.5 h-3.5" />
              Start Bot
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
