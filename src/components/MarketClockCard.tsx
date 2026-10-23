'use client';

import React from 'react';
import { Clock, Shield, AlertTriangle } from 'lucide-react';

interface MarketClockProps {
  clock: {
    isOpen: boolean;
    marketStatus: 'regular' | 'extended' | 'closed';
    nextEvent: string;
    nextEventTime: string;
    countdown: {
      hours: number;
      minutes: number;
      seconds: number;
      totalMs: number;
    };
  } | null;
}

export function MarketClockCard({ clock }: MarketClockProps) {
  const status = clock?.marketStatus || 'closed';
  const hours = String(clock?.countdown?.hours ?? 0).padStart(2, '0');
  const minutes = String(clock?.countdown?.minutes ?? 0).padStart(2, '0');
  const seconds = String(clock?.countdown?.seconds ?? 0).padStart(2, '0');

  const getStatusBadge = () => {
    switch (status) {
      case 'regular':
        return <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-3 py-1 rounded-full text-xs font-semibold">🟢 Regular Hours (Open)</span>;
      case 'extended':
        return <span className="bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 px-3 py-1 rounded-full text-xs font-semibold">🟡 Extended Hours</span>;
      default:
        return <span className="bg-red-500/10 text-red-400 border border-red-500/30 px-3 py-1 rounded-full text-xs font-semibold">🔴 Market Closed</span>;
    }
  };

  return (
    <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm flex flex-col justify-between">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Clock className="w-4 h-4 text-blue-400" />
          Market Clock & Schedule
        </h3>
        {getStatusBadge()}
      </div>

      <div className="flex items-center justify-between bg-background/50 border border-card-border/80 rounded-xl p-4 my-2">
        <div>
          <div className="text-xs text-muted font-medium mb-1">Next Event: {clock?.nextEvent || 'Market Open'}</div>
          <div className="text-xs text-slate-300">
            {clock?.nextEventTime ? new Date(clock.nextEventTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--'} ET
          </div>
        </div>

        {/* Countdown Timer */}
        <div className="flex items-center gap-1 font-mono text-2xl font-bold text-white bg-card px-4 py-2 rounded-lg border border-card-border shadow-inner">
          <span>{hours}</span>
          <span className="text-muted animate-pulse">:</span>
          <span>{minutes}</span>
          <span className="text-muted animate-pulse">:</span>
          <span className="text-blue-400">{seconds}</span>
        </div>
      </div>

      <div className="text-[11px] text-muted flex items-center justify-between pt-2">
        <span>Mon–Fri: 9:30 AM – 4:00 PM ET</span>
        <span>Crypto: 24/7/365</span>
      </div>
    </div>
  );
}
