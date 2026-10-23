'use client';

import React from 'react';
import { Newspaper } from 'lucide-react';
import type { StockSentiment } from '@/types/alpaca';

interface NewsSentimentTableProps {
  sentiments: StockSentiment[];
  loading: boolean;
}

export function NewsSentimentTable({ sentiments, loading }: NewsSentimentTableProps) {
  const getBadge = (sentiment: string) => {
    switch (sentiment.toUpperCase()) {
      case 'BULLISH':
        return <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded text-[10px] font-semibold">BULLISH</span>;
      case 'BEARISH':
        return <span className="bg-red-500/10 text-red-400 border border-red-500/30 px-2 py-0.5 rounded text-[10px] font-semibold">BEARISH</span>;
      default:
        return <span className="bg-slate-500/10 text-slate-400 border border-slate-500/30 px-2 py-0.5 rounded text-[10px] font-semibold">NEUTRAL</span>;
    }
  };

  return (
    <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Newspaper className="w-4 h-4 text-amber-400" />
            Top Stocks Live News Sentiment
          </h3>
          <p className="text-[11px] text-muted">VADER NLP Sentiment Analysis &bull; Cached in Cloudflare KV</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-card-border/80 text-muted uppercase text-[10px] tracking-wider font-semibold">
              <th className="pb-3">Symbol</th>
              <th className="pb-3">Sentiment</th>
              <th className="pb-3">Score (-1 to +1)</th>
              <th className="pb-3">Articles</th>
              <th className="pb-3">Latest Headline</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border/40 font-mono">
            {loading && sentiments.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-muted font-sans">
                  Analyzing news headlines...
                </td>
              </tr>
            ) : sentiments.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-muted font-sans">
                  No sentiment scores available.
                </td>
              </tr>
            ) : (
              sentiments.map((s) => {
                const score = Number(s.score || 0);
                const scoreColor = score > 0.05 ? 'text-emerald-400' : score < -0.05 ? 'text-red-400' : 'text-slate-400';

                return (
                  <tr key={s.symbol} className="hover:bg-card-hover/40 transition-colors">
                    <td className="py-2.5 font-bold text-white">{s.symbol}</td>
                    <td className="py-2.5">{getBadge(s.sentiment || 'NEUTRAL')}</td>
                    <td className={`py-2.5 font-bold ${scoreColor}`}>
                      {score > 0 ? '+' : ''}{score.toFixed(3)}
                    </td>
                    <td className="py-2.5 text-slate-300">{s.headlineCount || 0}</td>
                    <td className="py-2.5 text-slate-300 font-sans max-w-md truncate" title={s.topHeadline || ''}>
                      {s.topHeadline || '--'}
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
