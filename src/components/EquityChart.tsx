'use client';

import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp } from 'lucide-react';

interface EquitySnapshot {
  time: string;
  equity: number;
  pl: number;
}

interface EquityChartProps {
  data: EquitySnapshot[];
}

export function EquityChart({ data }: EquityChartProps) {
  const chartData = (data || []).map((d) => ({
    time: new Date(d.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    equity: d.equity,
    pl: d.pl,
  }));

  const minEquity = chartData.length > 0 ? Math.min(...chartData.map((d) => d.equity)) * 0.995 : 0;
  const maxEquity = chartData.length > 0 ? Math.max(...chartData.map((d) => d.equity)) * 1.005 : 10000;

  return (
    <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-blue-400" />
          Equity History Curve
        </h3>
        <span className="text-xs text-muted">Last {chartData.length} snapshots</span>
      </div>

      <div className="h-64 w-full">
        {chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-muted">
            Recording equity snapshots... Check back after the next 5-minute interval.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickLine={false} />
              <YAxis
                domain={[minEquity, maxEquity]}
                stroke="#64748b"
                fontSize={11}
                tickFormatter={(v) => `$${Math.round(v)}`}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#121722',
                  borderColor: '#1e2638',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '12px',
                }}
                formatter={(value: any) => [`$${Number(value).toFixed(2)}`, 'Equity']}
              />
              <Area type="monotone" dataKey="equity" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#equityGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
