export const DEFAULT_LIMIT = 8
export const MAX_LIMIT = 12
export const TRENDING_WINDOW_DAYS = 14

export function clampLimit(raw: unknown): number {
  const n = Number.parseInt(String(raw ?? ""), 10)
  if (!Number.isFinite(n)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, n))
}

/** Total units per product, highest first (ties by id for stable output). */
export function sumUnits(
  items: { product_id?: string | null; quantity?: number | null }[]
): { product_id: string; quantity: number }[] {
  const totals = new Map<string, number>()
  for (const item of items) {
    if (!item.product_id) continue
    totals.set(
      item.product_id,
      (totals.get(item.product_id) ?? 0) + Number(item.quantity ?? 0)
    )
  }
  return [...totals]
    .map(([product_id, quantity]) => ({ product_id, quantity }))
    .sort(
      (a, b) =>
        b.quantity - a.quantity || a.product_id.localeCompare(b.product_id)
    )
}

/**
 * Product ids to show: best sellers first (only `eligible` ones, i.e.
 * published and visible to the key), then the newest products, no duplicates.
 */
export function rankTrending(
  sold: { product_id: string; quantity: number }[],
  eligible: Set<string>,
  newestIds: string[],
  limit: number
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const ordered = [
    ...sumUnits(sold)
      .filter((s) => eligible.has(s.product_id))
      .map((s) => s.product_id),
    ...newestIds,
  ]
  for (const id of ordered) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= limit) break
  }
  return out
}

export const TRENDING_TTL_MS = 300_000
export const MAX_ORDER_PAGES = 20

export function trendingCacheKey(channelIds: string[], limit: number): string {
  return `${[...channelIds].sort().join(",")}|${limit}`
}

/** Tiny in-process TTL cache; the clock is injected so tests are deterministic. */
export function createTtlCache<T>(now: () => number, ttlMs: number) {
  const entries = new Map<string, { at: number; value: T }>()
  return {
    async getOrLoad(key: string, loader: () => Promise<T>): Promise<T> {
      const hit = entries.get(key)
      if (hit && now() - hit.at < ttlMs) return hit.value
      const value = await loader()
      entries.set(key, { at: now(), value })
      return value
    },
  }
}

/** Run a loader; on failure log and return the empty value flagged as degraded. */
export async function loadOrDegrade<T>(
  loader: () => Promise<T>,
  empty: T,
  logger: { error: (msg: string) => void },
  prefix: string
): Promise<{ value: T; degraded: boolean }> {
  try {
    return { value: await loader(), degraded: false }
  } catch (e) {
    logger.error(`${prefix} ${e instanceof Error ? e.message : String(e)}`)
    return { value: empty, degraded: true }
  }
}
