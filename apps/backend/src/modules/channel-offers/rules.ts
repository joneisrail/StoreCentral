export type Stocks = Record<string, number>

export function splitEqually(total: number, channelIds: string[]): Stocks {
  const n = channelIds.length
  const out: Stocks = {}
  if (n === 0) return out
  const safe = Math.max(0, Math.floor(total))
  const base = Math.floor(safe / n)
  const extra = safe % n
  channelIds.forEach((id, i) => {
    out[id] = base + (i < extra ? 1 : 0)
  })
  return out
}

export function resplitPool(stocks: Stocks, channelIds: string[]): Stocks {
  const sum = Object.values(stocks).reduce((s, v) => s + v, 0)
  return splitEqually(sum, channelIds)
}

export function deduct(stocks: Stocks, channelId: string, qty: number): Stocks {
  return { ...stocks, [channelId]: Math.max(0, (stocks[channelId] ?? 0) - qty) }
}

export function trimToTotal(
  stocks: Stocks,
  total: number,
  order: string[] = Object.keys(stocks)
): { stocks: Stocks; trimmed: Stocks } {
  const next: Stocks = { ...stocks }
  const trimmed: Stocks = {}
  const ids = [...order, ...Object.keys(stocks).filter((k) => !order.includes(k))].filter(
    (k) => k in stocks
  )
  let sum = ids.reduce((s, id) => s + next[id], 0)
  while (sum > total) {
    let best = ids[0]
    for (const id of ids) if (next[id] > next[best]) best = id
    if (next[best] <= 0) break
    next[best] -= 1
    trimmed[best] = (trimmed[best] ?? 0) + 1
    sum -= 1
  }
  return { stocks: next, trimmed }
}
