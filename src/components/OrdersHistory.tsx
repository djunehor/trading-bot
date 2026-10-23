'use client';

import React from 'react';
import { ShoppingCart, Ban } from 'lucide-react';

interface OrderItem {
  id: string;
  symbol: string;
  side: string;
  type: string;
  qty?: number | string | null;
  status: string;
  filled_avg_price?: number | string | null;
  submitted_at?: string | null;
  created_at?: string;
  reason?: string | null;
}

interface OrdersHistoryProps {
  orders: OrderItem[];
  onCancelOrder: (id: string) => void;
  isCanceling: string | null;
}

export function OrdersHistory({ orders, onCancelOrder, isCanceling }: OrdersHistoryProps) {
  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'filled':
        return <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded text-[10px] font-semibold">FILLED</span>;
      case 'new':
      case 'accepted':
      case 'pending_new':
        return <span className="bg-blue-500/10 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded text-[10px] font-semibold">OPEN</span>;
      case 'canceled':
      case 'expired':
        return <span className="bg-slate-500/10 text-slate-400 border border-slate-500/30 px-2 py-0.5 rounded text-[10px] font-semibold">{status.toUpperCase()}</span>;
      default:
        return <span className="bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded text-[10px] font-semibold">{status.toUpperCase()}</span>;
    }
  };

  return (
    <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <ShoppingCart className="w-4 h-4 text-purple-400" />
          Orders History
        </h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-card-border/80 text-muted uppercase text-[10px] tracking-wider font-semibold">
              <th className="pb-3">Date</th>
              <th className="pb-3">Symbol</th>
              <th className="pb-3">Side</th>
              <th className="pb-3">Type</th>
              <th className="pb-3">Qty</th>
              <th className="pb-3">Fill Price</th>
              <th className="pb-3">Status</th>
              <th className="pb-3">Reason</th>
              <th className="pb-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border/40 font-mono">
            {orders.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-muted font-sans">
                  No orders recorded yet.
                </td>
              </tr>
            ) : (
              orders.map((ord) => {
                const dateStr = ord.submitted_at || ord.created_at || '';
                const displayDate = dateStr
                  ? new Date(dateStr).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : '--';
                const isBuy = ord.side.toLowerCase() === 'buy';
                const isOpen = ['new', 'accepted', 'pending_new'].includes(ord.status.toLowerCase());

                return (
                  <tr key={ord.id} className="hover:bg-card-hover/40 transition-colors">
                    <td className="py-3 text-muted text-[11px] font-sans">{displayDate}</td>
                    <td className="py-3 font-semibold text-white">{ord.symbol}</td>
                    <td className="py-3">
                      <span
                        className={`font-semibold uppercase text-[11px] ${
                          isBuy ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {ord.side}
                      </span>
                    </td>
                    <td className="py-3 text-slate-300 uppercase text-[11px]">{ord.type}</td>
                    <td className="py-3 text-slate-300">{ord.qty || '--'}</td>
                    <td className="py-3 text-slate-300">
                      {ord.filled_avg_price ? `$${Number(ord.filled_avg_price).toFixed(2)}` : '--'}
                    </td>
                    <td className="py-3">{getStatusBadge(ord.status)}</td>
                    <td className="py-3 text-muted text-[11px] font-sans max-w-[200px] truncate" title={ord.reason || ''}>
                      {ord.reason || '--'}
                    </td>
                    <td className="py-3 text-right">
                      {isOpen && (
                        <button
                          onClick={() => onCancelOrder(ord.id)}
                          disabled={isCanceling === ord.id}
                          className="inline-flex items-center gap-1 text-[11px] font-sans font-medium px-2 py-0.5 rounded bg-slate-700/50 hover:bg-slate-700 text-slate-300 transition-all disabled:opacity-50"
                        >
                          <Ban className="w-3 h-3 text-red-400" />
                          Cancel
                        </button>
                      )}
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
