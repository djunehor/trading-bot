'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Header } from '@/components/Header';
import { AccountOverview } from '@/components/AccountOverview';
import { PortfolioAllocation } from '@/components/PortfolioAllocation';
import { MarketClockCard } from '@/components/MarketClockCard';
import { EquityChart } from '@/components/EquityChart';
import { BotControls } from '@/components/BotControls';
import { ActivePositions } from '@/components/ActivePositions';
import { OrdersHistory } from '@/components/OrdersHistory';
import { NewsSentimentTable } from '@/components/NewsSentimentTable';
import { BotLogsViewer } from '@/components/BotLogsViewer';
import { Backtester } from '@/components/Backtester';
import { ManualOrderModal } from '@/components/ManualOrderModal';
import { PlusCircle, AlertTriangle } from 'lucide-react';
import type { AlpacaPosition, StockSentiment, BotLog } from '@/types/alpaca';

export default function DashboardPage() {
  const [currentAccountId, setCurrentAccountId] = useState('clean');
  const [accounts, setAccounts] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [positions, setPositions] = useState<AlpacaPosition[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [clock, setClock] = useState<any>(null);
  const [equityHistory, setEquityHistory] = useState<any[]>([]);
  const [sentiments, setSentiments] = useState<StockSentiment[]>([]);
  const [botStatus, setBotStatus] = useState<any>(null);
  const [botLogs, setBotLogs] = useState<BotLog[]>([]);
  const [mode, setMode] = useState<'paper' | 'live'>('paper');

  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTriggeringTick, setIsTriggeringTick] = useState(false);
  const [isClosingPosition, setIsClosingPosition] = useState<string | null>(null);
  const [isCancelingOrder, setIsCancelingOrder] = useState<string | null>(null);
  const [manualOrderOpen, setManualOrderOpen] = useState(false);

  const fetchDashboardData = useCallback(async () => {
    try {
      const headers: Record<string, string> = {
        'x-target-account': currentAccountId,
      };

      const [
        accountsRes,
        summaryRes,
        positionsRes,
        ordersRes,
        clockRes,
        historyRes,
        sentimentRes,
        botStatusRes,
        botLogsRes,
        modeRes,
      ] = await Promise.all([
        fetch('/api/accounts/summary', { headers }).catch(() => null),
        fetch('/api/account', { headers }).catch(() => null),
        fetch('/api/positions', { headers }).catch(() => null),
        fetch('/api/orders?limit=30', { headers }).catch(() => null),
        fetch('/api/market/clock').catch(() => null),
        fetch('/api/account/equity-history?limit=100', { headers }).catch(() => null),
        fetch('/api/news/sentiment').catch(() => null),
        fetch('/api/bot/status', { headers }).catch(() => null),
        fetch('/api/bot/logs?limit=50', { headers }).catch(() => null),
        fetch('/api/mode').catch(() => null),
      ]);

      if (accountsRes?.ok) setAccounts(await accountsRes.json());
      if (summaryRes?.ok) setSummary(await summaryRes.json());
      if (positionsRes?.ok) setPositions(await positionsRes.json());
      if (ordersRes?.ok) {
        const ordData = (await ordersRes.json()) as any;
        setOrders(ordData.orders || []);
      }
      if (clockRes?.ok) setClock(await clockRes.json());
      if (historyRes?.ok) setEquityHistory((await historyRes.json()) as any[]);
      if (sentimentRes?.ok) setSentiments((await sentimentRes.json()) as any[]);
      if (botStatusRes?.ok) setBotStatus(await botStatusRes.json());
      if (botLogsRes?.ok) {
        const logsData = (await botLogsRes.json()) as any;
        setBotLogs(logsData.logs || []);
      }
      if (modeRes?.ok) {
        const modeData = (await modeRes.json()) as any;
        if (modeData.mode) setMode(modeData.mode);
      }
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [currentAccountId]);

  useEffect(() => {
    void fetchDashboardData();
    // Poll updates every 15 seconds
    const interval = setInterval(() => {
      void fetchDashboardData();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchDashboardData]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    void fetchDashboardData();
  };

  const handleToggleMode = async (newMode: 'paper' | 'live') => {
    try {
      const res = await fetch('/api/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
      if (res.ok) {
        setMode(newMode);
        void fetchDashboardData();
      }
    } catch {
      // Ignore mode change error
    }
  };

  const handleTriggerTick = async () => {
    setIsTriggeringTick(true);
    try {
      await fetch('/api/bot/tick', { method: 'POST' });
      await fetchDashboardData();
    } finally {
      setIsTriggeringTick(false);
    }
  };

  const handleStartBot = async (assetClass: 'us_equity' | 'crypto', config?: any) => {
    try {
      await fetch('/api/bot/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetClass, ...config }),
      });
      void fetchDashboardData();
    } catch {
      // Ignore start bot error
    }
  };

  const handleStopBot = async (assetClass: 'us_equity' | 'crypto') => {
    try {
      await fetch('/api/bot/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetClass }),
      });
      void fetchDashboardData();
    } catch {
      // Ignore stop bot error
    }
  };

  const handleClosePosition = async (symbol: string) => {
    setIsClosingPosition(symbol);
    try {
      await fetch(`/api/positions/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
      void fetchDashboardData();
    } finally {
      setIsClosingPosition(null);
    }
  };

  const handleCancelOrder = async (id: string) => {
    setIsCancelingOrder(id);
    try {
      await fetch(`/api/orders/${id}`, { method: 'DELETE' });
      void fetchDashboardData();
    } finally {
      setIsCancelingOrder(null);
    }
  };

  const handleManualOrder = async (orderData: any) => {
    await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderData),
    });
    void fetchDashboardData();
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Header
        accounts={accounts}
        currentAccountId={currentAccountId}
        onSelectAccount={setCurrentAccountId}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        onTriggerTick={handleTriggerTick}
        isTriggeringTick={isTriggeringTick}
        mode={mode}
        onToggleMode={handleToggleMode}
      />

      {/* Live Warning Banner */}
      {mode === 'live' && (
        <div className="bg-red-500/15 border-b border-red-500/30 px-6 py-2.5 flex items-center gap-2 text-xs text-red-300 font-medium">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <span>
            <strong>LIVE TRADING MODE ACTIVE:</strong> Orders executed in this mode trade with REAL CAPITAL on Alpaca live markets.
          </span>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full space-y-6">
        {/* Top Controls Bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-white tracking-tight">Trading Dashboard</h2>
          </div>
          <button
            onClick={() => setManualOrderOpen(true)}
            className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20 transition-all"
          >
            <PlusCircle className="w-4 h-4" />
            Place Order
          </button>
        </div>

        {/* Section 1: Overview Metrics */}
        <AccountOverview summary={summary} loading={loading} />

        {/* Section 2: Clock & Asset Allocation */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <MarketClockCard clock={clock} />
          <PortfolioAllocation summary={summary} positions={positions} />
        </div>

        {/* Section 3: Equity History Curve */}
        <EquityChart data={equityHistory} />

        {/* Section 4: Automated Bot Controls */}
        <BotControls
          stockBot={botStatus?.stockBot || null}
          cryptoBot={botStatus?.cryptoBot || null}
          onStartBot={handleStartBot}
          onStopBot={handleStopBot}
        />

        {/* Section 5: Active Positions Table */}
        <ActivePositions
          positions={positions}
          onClosePosition={handleClosePosition}
          isClosing={isClosingPosition}
        />

        {/* Section 6: Orders History Table */}
        <OrdersHistory
          orders={orders}
          onCancelOrder={handleCancelOrder}
          isCanceling={isCancelingOrder}
        />

        {/* Section 7: Top Stocks Live Sentiment */}
        <NewsSentimentTable sentiments={sentiments} loading={loading} />

        {/* Section 8: Live Bot Activity Logs */}
        <BotLogsViewer logs={botLogs} />

        {/* Section 9: Historical Strategy Backtester */}
        <Backtester />
      </main>

      {/* Manual Order Modal */}
      <ManualOrderModal
        isOpen={manualOrderOpen}
        onClose={() => setManualOrderOpen(false)}
        onSubmit={handleManualOrder}
      />
    </div>
  );
}
