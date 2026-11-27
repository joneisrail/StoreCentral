import { sdk } from "@lib/config"

const MIN = 3
const MAX = 60

/**
 * Fire-and-forget search analytics, run in the browser. It goes through the
 * shared sdk, as the search client does: the publishable key is public by
 * design in Medusa storefronts. Never throws.
 */
export function trackSearch(query: string, results: number): void {
  try {
    const q = query.trim()
    if (q.length < MIN || q.length > MAX) {
      return
    }
    const count = Number.isFinite(results) ? Math.max(0, Math.trunc(results)) : 0
    void Promise.resolve(
      sdk.client.fetch("/store/search/events", {
        method: "POST",
        body: { query: q, results: count },
        keepalive: true,
      })
    ).catch(() => {})
  } catch {
    // analytics must never affect search
  }
}
