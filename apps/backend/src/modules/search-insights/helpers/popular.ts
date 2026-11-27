export const POPULAR_WINDOW_DAYS = 30
export const POPULAR_LIMIT = 8

export type PopularRow = {
  query: string
  count: number
  last_seen_at: string | Date
  results_count: number
}

/**
 * Searches seen in the last 30 days, at least twice, that found something.
 * Highest count first, ties alphabetical, capped at 8.
 */
export function rankPopular(
  rows: PopularRow[],
  now: Date
): { query: string; count: number }[] {
  const cutoff = now.getTime() - POPULAR_WINDOW_DAYS * 24 * 60 * 60 * 1000
  return rows
    .filter(
      (r) =>
        r.count >= 2 &&
        r.results_count > 0 &&
        new Date(r.last_seen_at).getTime() >= cutoff
    )
    .sort((a, b) => b.count - a.count || a.query.localeCompare(b.query))
    .slice(0, POPULAR_LIMIT)
    .map((r) => ({ query: r.query, count: r.count }))
}
