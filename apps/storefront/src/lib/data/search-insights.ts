import { sdk } from "@lib/config"

export type TrendingProduct = {
  id: string
  title: string
  handle: string
  thumbnail: string | null
}

const TIMEOUT_MS = 2500
const REVALIDATE_SECONDS = 300
export const TRENDING_LIMIT = 8

const init = () => ({
  method: "GET" as const,
  // A slow insights route degrades to "no suggestions" instead of blocking.
  signal: AbortSignal.timeout(TIMEOUT_MS),
  next: { revalidate: REVALIDATE_SECONDS },
})

/** Popular search queries, or null on any failure. Server-side only. */
export async function getPopularSearches(): Promise<string[] | null> {
  try {
    const res = await sdk.client.fetch<{
      queries?: { query: string; count: number }[]
    }>("/store/search/popular", init())
    if (!res || !Array.isArray(res.queries)) {
      return null
    }
    return res.queries
      .map((q) => q?.query)
      .filter((q): q is string => typeof q === "string" && q.length > 0)
  } catch {
    return null
  }
}

/** Trending products, or null on any failure. Server-side only. */
export async function getTrendingProducts(): Promise<TrendingProduct[] | null> {
  try {
    const res = await sdk.client.fetch<{ products?: TrendingProduct[] }>(
      "/store/search/trending",
      { ...init(), query: { limit: TRENDING_LIMIT } }
    )
    if (!res || !Array.isArray(res.products)) {
      return null
    }
    return res.products
  } catch {
    return null
  }
}
