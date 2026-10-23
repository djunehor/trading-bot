'use client';

import React from 'react';
import { DollarSign, TrendingUp, Award, Zap, Coins, Activity } from 'lucide-react';

interface AccountOverviewProps {
  summary: {
    equity?: string | number;
    portfolio_value?: string | number;
    buying_power?: string | number;
    cash?: string | number;
    daily_change?: string | number;
    daily_change_pct?: string | number;
    all_time_pl?: string | number;
    all_time_pl_pct?: string | number;
    crypto_unrealized_pl?: string | number;
    crypto_realized_pl?: string | number;
    status?: string;
  } | null;
  loading: boolean;
}

export function AccountOverview({ summary, loading }: AccountOverviewProps) {
  const equity = Number(summary?.equity ?? summary?.portfolio_value ?? 0);
  const dailyChange = Number(summary?.daily_change ?? 0);
  const dailyChangePct = Number(summary?.daily_change_pct ?? 0);
  const allTimePl = Number(summary?.all_time_pl ?? 0);
  const allTimePlPct = Number(summary?.all_time_pl_pct ?? 0);
  const buyingPower = Number(summary?.buying_power ?? 0);
  const cash = Number(summary?.cash ?? 0);
  const cryptoUnrealized = Number(summary?.crypto_unrealized_pl ?? 0);
  const cryptoRealized = Number(summary?.crypto_realized_pl ?? 0);
  const status = summary?.status || 'ACTIVE';

  const fmt = (num: number) => num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <section className="bg-card border border-card-border rounded-2xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-base font-semibold text-white flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-400" />
          Account Overview
        </h2>
        <span
          className={`text-xs px-2.5 py-1 rounded-full font-medium border ${
            status === 'ACTIVE'
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
              : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30'
          }`}
        >
          {loading ? 'SYNCING...' : status}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {/* Total Equity */}
        <div className="bg-background/60 border border-card-border/80 rounded-xl p-3.5 flex flex-col justify-between">
          <div className="text-xs text-muted font-medium mb-1 flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5 text-blue-400" />
            Equity
          </div>
          <div className="text-xl font-bold font-mono text-white tracking-tight">
            ${loading ? '---' : fmt(equity)}
          </div>
        </div>

        {/* All-time P/L */}
        <div className="bg-background/60 border border-card-border/80 rounded-xl p-3.5 flex flex-col justify-between">
          <div className="text-xs text-muted font-medium mb-1 flex items-center gap-1.5">
            <Award className="w-3.5 h-3.5 text-amber-400" />
            All-Time P/L
          </div>
          <div
            className={`text-xl font-bold font-mono tracking-tight ${
              allTimePl >= 0 ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {loading ? '---' : `${allTimePl >= 0 ? '+' : ''}$${fmt(allTimePl)}`}
            <span className="text-xs ml-1 font-normal opacity-80">
              ({allTimePlPct >= 0 ? '+' : ''}{allTimePlPct.toFixed(2)}%)
            </span>
          </div>
        </div>

        {/* Today's Change */}
        <div className="bg-background/60 border border-card-border/80 rounded-xl p-3.5 flex flex-col justify-between">
          <div className="text-xs text-muted font-medium mb-1 flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            Today&apos;s Change
          </div>
          <div
            className={`text-xl font-bold font-mono tracking-tight ${
              dailyChange >= 0 ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {loading ? '---' : `${dailyChange >= 0 ? '+' : ''}$${fmt(dailyChange)}`}
            <span className="text-xs ml-1 font-normal opacity-80">
              ({dailyChangePct >= 0 ? '+' : ''}{dailyChangePct.toFixed(2)}%)
            </span>
          </div>
        </div>

        {/* Buying Power */}
        <div className="bg-background/60 border border-card-border/80 rounded-xl p-3.5 flex flex-col justify-between">
          <div className="text-xs text-muted font-medium mb-1 flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-purple-400" />
            Buying Power
          </div>
          <div className="text-xl font-bold font-mono text-white tracking-tight">
            ${loading ? '---' : fmt(buyingPower)}
          </div>
        </div>

        {/* Cash */}
        <div className="bg-background/60 border border-card-border/80 rounded-xl p-3.5 flex flex-col justify-between">
          <div className="text-xs text-muted font-medium mb-1">Cash</div>
          <div className="text-xl font-bold font-mono text-white tracking-tight">
            ${loading ? '---' : fmt(cash)}
          </div>
        </div>

        {/* Crypto P/L */}
        <div className="bg-background/60 border border-card-border/80 rounded-xl p-3.5 flex flex-col justify-between">
          <div className="text-xs text-muted font-medium mb-1 flex items-center gap-1.5">
            <Coins className="w-3.5 h-3.5 text-yellow-400" />
            Crypto Unrealized
          </div>
          <div
            className={`text-xl font-bold font-mono tracking-tight ${
              cryptoUnrealized >= 0 ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {loading ? '---' : `${cryptoUnrealized >= 0 ? '+' : ''}$${fmt(cryptoUnrealized)}`}
          </div>
        </div>
      </div>
    </section>
  );
}
