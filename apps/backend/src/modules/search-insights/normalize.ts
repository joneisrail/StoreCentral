export const MIN_QUERY_LENGTH = 3
export const MAX_QUERY_LENGTH = 60

/**
 * Canonical form of a shopper's search text, or null when it should not be
 * recorded (too short, too long, or no letter/number at all). Unicode aware:
 * "Hermès" stays "hermès".
 */
export function normalizeQuery(raw: string): string | null {
  if (typeof raw !== "string") {
    return null
  }
  const query = raw.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim()
  if (query.length < MIN_QUERY_LENGTH || query.length > MAX_QUERY_LENGTH) {
    return null
  }
  if (!/[\p{L}\p{N}]/u.test(query)) {
    return null
  }
  return query
}
