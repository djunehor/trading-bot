'use client';

import React, { useState } from 'react';
import { RefreshCw, Play, ShieldAlert, ChevronDown, Check } from 'lucide-react';

interface AccountOption {
  id: string;
  name: string;
  accountNumber: string;
  subtitle: string;
  shortLabel: string;
  equity: number;
  changePct: number;
  mode: string;
}

interface HeaderProps {
  accounts: AccountOption[];
  currentAccountId: string;
  onSelectAccount: (id: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onTriggerTick: () => void;
  isTriggeringTick: boolean;
  mode: 'paper' | 'live';
  onToggleMode: (newMode: 'paper' | 'live') => void;
}

export function Header({
  accounts,
  currentAccountId,
  onSelectAccount,
  onRefresh,
  isRefreshing,
  onTriggerTick,
  isTriggeringTick,
  mode,
  onToggleMode,
}: HeaderProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const currentAccount = accounts.find((a) => a.id === currentAccountId) || accounts[0];

  return (
    <header className="bg-card border-b border-card-border px-6 py-4 sticky top-0 z-40 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-xl shadow-lg shadow-blue-500/10">
          📈
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-white">Trade Automation</h1>
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                mode === 'live'
                  ? 'bg-red-500/20 text-red-400 border-red-500/40'
                  : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
              }`}
            >
              {mode.toUpperCase()}
            </span>
          </div>
          <p className="text-xs text-muted">Cloudflare Edge &bull; Alpaca Sentiment Engine</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Mode Toggle */}
        <div className="flex rounded-lg bg-background p-1 border border-card-border text-xs font-medium">
          <button
            onClick={() => onToggleMode('paper')}
            className={`px-3 py-1 rounded-md transition-all ${
              mode === 'paper' ? 'bg-card text-emerald-400 shadow-sm' : 'text-muted hover:text-white'
            }`}
          >
            Paper
          </button>
          <button
            onClick={() => onToggleMode('live')}
            className={`px-3 py-1 rounded-md transition-all ${
              mode === 'live' ? 'bg-red-500/20 text-red-400 shadow-sm' : 'text-muted hover:text-white'
            }`}
          >
            Live
          </button>
        </div>

        {/* Manual Tick Trigger Button */}
        <button
          onClick={onTriggerTick}
          disabled={isTriggeringTick}
          title="Trigger 1-minute automated trading tick now"
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 transition-all disabled:opacity-50"
        >
          <Play className={`w-3.5 h-3.5 ${isTriggeringTick ? 'animate-pulse' : ''}`} />
          <span>{isTriggeringTick ? 'Running Tick...' : 'Run Tick'}</span>
        </button>

        {/* Refresh Dashboard Button */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-card hover:bg-card-hover border border-card-border text-slate-200 transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-blue-400' : ''}`} />
          <span>Refresh</span>
        </button>

        {/* Account Switcher Dropdown */}
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2.5 bg-card hover:bg-card-hover border border-card-border px-3 py-1.5 rounded-lg text-left transition-all"
          >
            <div className="w-6 h-6 rounded-md bg-yellow-500/20 text-yellow-400 flex items-center justify-center font-bold text-xs">
              A
            </div>
            <div className="text-xs">
              <div className="font-semibold text-white leading-tight">{currentAccount?.name || 'Trading-bot'}</div>
              <div className="text-muted text-[10px]">{currentAccount?.shortLabel || 'PA3JYOC8B'}</div>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-muted ml-1" />
          </button>

          {dropdownOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} />
              <div className="absolute right-0 mt-2 w-72 rounded-xl bg-card border border-card-border shadow-2xl p-2 z-50">
                <div className="text-[11px] font-semibold text-muted px-2 py-1.5 uppercase tracking-wider">
                  Select Account
                </div>
                <div className="space-y-1">
                  {accounts.map((acc) => {
                    const isSelected = acc.id === currentAccountId;
                    return (
                      <button
                        key={acc.id}
                        onClick={() => {
                          onSelectAccount(acc.id);
                          setDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between p-2 rounded-lg text-left text-xs transition-colors ${
                          isSelected ? 'bg-blue-600/15 border border-blue-500/30 text-white' : 'hover:bg-card-hover text-slate-300'
                        }`}
                      >
                        <div>
                          <div className="font-semibold">{acc.name}</div>
                          <div className="text-[11px] text-muted">{acc.subtitle}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono font-medium">${acc.equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                          <div
                            className={`text-[10px] font-mono ${
                              acc.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'
                            }`}
                          >
                            {acc.changePct >= 0 ? '+' : ''}
                            {acc.changePct.toFixed(2)}%
                          </div>
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-blue-400 ml-2" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
