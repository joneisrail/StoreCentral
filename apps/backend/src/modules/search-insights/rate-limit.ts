export type RateLimiter = {
  /** True when this key is still within its budget (and counts the hit). */
  allow(key: string): boolean
}

/**
 * Fixed-window, in-memory limiter. State lives in this process only, so with
 * several backend instances each one enforces its own budget (the effective
 * limit is limit x instances). Acceptable for abuse damping on a public,
 * low-value endpoint; swap for Redis if it ever needs to be exact.
 */
export function createRateLimiter(options: {
  limit: number
  windowMs: number
  now?: () => number
  maxKeys?: number
}): RateLimiter {
  const { limit, windowMs, now = Date.now, maxKeys = 10000 } = options
  const windows = new Map<string, { start: number; hits: number }>()

  return {
    allow(key) {
      const t = now()
      const entry = windows.get(key)
      if (!entry || t - entry.start >= windowMs) {
        if (windows.size >= maxKeys) {
          for (const [k, v] of windows) {
            if (t - v.start >= windowMs) windows.delete(k)
          }
          if (windows.size >= maxKeys) windows.clear()
        }
        windows.set(key, { start: t, hits: 1 })
        return true
      }
      if (entry.hits >= limit) {
        return false
      }
      entry.hits += 1
      return true
    },
  }
}

export type QueryDeduper = {
  /**
   * True the first time `key` is seen within the window (and claims it);
   * false while an earlier claim of the same key is still inside it.
   */
  claim(key: string): boolean
  /** Forgets a claim, for when the event it was taken for was not recorded. */
  release(key: string): void
}

/**
 * Remembers which (client, query) pairs were recorded recently, so one client
 * repeating a query cannot push it up the popular list: each pair counts at
 * most once per window. In-memory and per process, like the limiter; the map
 * is pruned of expired claims when full and cleared outright if that is not
 * enough, which at worst lets a pair count once more.
 */
export function createQueryDeduper(options: {
  windowMs: number
  now?: () => number
  maxKeys?: number
}): QueryDeduper {
  const { windowMs, now = Date.now, maxKeys = 50000 } = options
  const claims = new Map<string, number>()

  return {
    claim(key) {
      const t = now()
      const at = claims.get(key)
      if (at !== undefined && t - at < windowMs) {
        return false
      }
      if (at === undefined && claims.size >= maxKeys) {
        for (const [k, v] of claims) {
          if (t - v >= windowMs) claims.delete(k)
        }
        if (claims.size >= maxKeys) claims.clear()
      }
      claims.set(key, t)
      return true
    },
    release(key) {
      claims.delete(key)
    },
  }
}
