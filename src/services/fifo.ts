export interface FifoLot {
  qty: number;
  price: number;
}

/**
 * Matches a sell order against queued buy lots using FIFO, mutating the queue in place.
 * Returns the realized P/L and matched quantity.
 */
export function matchSellFifo(
  buyQueue: Record<string, FifoLot[]>,
  symbol: string,
  sellQty: number,
  sellPrice: number,
): { realizedPl: number; matchedQty: number } {
  const lots = buyQueue[symbol];
  let remaining = sellQty;
  let realizedPl = 0;
  let matchedQty = 0;
  while (lots !== undefined && remaining > 0 && lots.length > 0) {
    const lot = lots[0];
    const matched = Math.min(remaining, lot.qty);
    realizedPl += matched * (sellPrice - lot.price);
    matchedQty += matched;
    remaining -= matched;
    lot.qty -= matched;
    if (lot.qty <= 0) {
      lots.shift();
    }
  }
  return { realizedPl, matchedQty };
}
