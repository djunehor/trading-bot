'use client';

import React, { useState } from 'react';
import { PlusCircle, X } from 'lucide-react';

interface ManualOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (order: {
    symbol: string;
    qty: number;
    side: 'buy' | 'sell';
    type: string;
    limit_price?: number;
    stop_price?: number;
    extended_hours?: boolean;
  }) => Promise<void>;
}

export function ManualOrderModal({ isOpen, onClose, onSubmit }: ManualOrderModalProps) {
  const [symbol, setSymbol] = useState('');
  const [qty, setQty] = useState('');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [type, setType] = useState('market');
  const [limitPrice, setLimitPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [extendedHours, setExtendedHours] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol || !qty) return;

    setSubmitting(true);
    try {
      await onSubmit({
        symbol: symbol.toUpperCase(),
        qty: Number(qty),
        side,
        type,
        limit_price: limitPrice ? Number(limitPrice) : undefined,
        stop_price: stopPrice ? Number(stopPrice) : undefined,
        extended_hours: extendedHours,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-card border border-card-border rounded-2xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <PlusCircle className="w-5 h-5 text-blue-400" />
            Place Manual Order
          </h3>
          <button onClick={onClose} className="text-muted hover:text-white p-1 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-muted font-medium block mb-1">Symbol</label>
              <input
                type="text"
                placeholder="e.g. AAPL, BTC/USD"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                required
                className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-white font-mono uppercase focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="text-muted font-medium block mb-1">Quantity</label>
              <input
                type="number"
                step="any"
                placeholder="Shares or Coins"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                required
                className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-muted font-medium block mb-1">Side</label>
              <div className="grid grid-cols-2 gap-1 bg-background p-1 rounded-lg border border-card-border">
                <button
                  type="button"
                  onClick={() => setSide('buy')}
                  className={`py-1.5 rounded-md font-semibold transition-all ${
                    side === 'buy' ? 'bg-emerald-600 text-white' : 'text-muted hover:text-white'
                  }`}
                >
                  BUY
                </button>
                <button
                  type="button"
                  onClick={() => setSide('sell')}
                  className={`py-1.5 rounded-md font-semibold transition-all ${
                    side === 'sell' ? 'bg-red-600 text-white' : 'text-muted hover:text-white'
                  }`}
                >
                  SELL
                </button>
              </div>
            </div>

            <div>
              <label className="text-muted font-medium block mb-1">Order Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              >
                <option value="market">Market</option>
                <option value="limit">Limit</option>
                <option value="stop">Stop</option>
              </select>
            </div>
          </div>

          {type === 'limit' && (
            <div>
              <label className="text-muted font-medium block mb-1">Limit Price ($)</label>
              <input
                type="number"
                step="0.01"
                placeholder="Limit Price"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                required
                className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-blue-500"
              />
            </div>
          )}

          {type === 'stop' && (
            <div>
              <label className="text-muted font-medium block mb-1">Stop Price ($)</label>
              <input
                type="number"
                step="0.01"
                placeholder="Stop Price"
                value={stopPrice}
                onChange={(e) => setStopPrice(e.target.value)}
                required
                className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-blue-500"
              />
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="extHours"
              checked={extendedHours}
              onChange={(e) => setExtendedHours(e.target.checked)}
              className="rounded bg-background border-card-border text-blue-600 focus:ring-0"
            />
            <label htmlFor="extHours" className="text-slate-300 cursor-pointer">
              Allow Extended Hours Execution
            </label>
          </div>

          <div className="pt-3 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="w-1/2 py-2 rounded-lg bg-background hover:bg-card-hover border border-card-border text-slate-300 font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="w-1/2 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-all disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit Order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
