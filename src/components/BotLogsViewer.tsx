'use client';

import React, { useState } from 'react';
import { Terminal, Filter } from 'lucide-react';
import type { BotLog } from '@/types/alpaca';

interface BotLogsViewerProps {
  logs: BotLog[];
}

export function BotLogsViewer({ logs }: BotLogsViewerProps) {
  const [filter, setFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all');

  const filteredLogs = logs.filter((l) => {
    if (filter === 'all') return true;
    return (l.type || 'info').toLowerCase() === filter;
  });

  const getLogColor = (type: string) => {
    switch (type.toLowerCase()) {
      case 'error':
        return 'text-red-400';
      case 'warn':
      case 'warning':
        return 'text-yellow-400';
      case 'success':
        return 'text-emerald-400';
      default:
        return 'text-slate-300';
    }
  };

  return (
    <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Terminal className="w-4 h-4 text-emerald-400" />
          Bot Activity Logs
        </h3>

        <div className="flex items-center gap-1.5 bg-background border border-card-border p-1 rounded-lg text-xs">
          <Filter className="w-3 h-3 text-muted ml-1" />
          {(['all', 'info', 'warn', 'error'] as const).map((lvl) => (
            <button
              key={lvl}
              onClick={() => setFilter(lvl)}
              className={`px-2 py-0.5 rounded text-[11px] capitalize transition-colors ${
                filter === lvl ? 'bg-card text-white font-medium shadow-sm' : 'text-muted hover:text-white'
              }`}
            >
              {lvl}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-background/80 border border-card-border/80 rounded-xl p-4 font-mono text-xs h-64 overflow-y-auto space-y-1.5">
        {filteredLogs.length === 0 ? (
          <div className="text-muted text-center py-10 font-sans">No activity logs recorded.</div>
        ) : (
          filteredLogs.map((log, idx) => {
            const time = log.timestamp
              ? new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
              : '--:--:--';
            return (
              <div key={idx} className="flex items-start gap-2 leading-relaxed">
                <span className="text-muted select-none text-[11px] shrink-0">[{time}]</span>
                <span className={`break-words ${getLogColor(log.type || 'info')}`}>{log.message}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
