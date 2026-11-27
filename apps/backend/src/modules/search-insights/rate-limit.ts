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
