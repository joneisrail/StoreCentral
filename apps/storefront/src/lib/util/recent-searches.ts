export const RECENT_SEARCHES_KEY = "sc-recent-searches"
export const RECENT_SEARCHES_CAP = 8
export const RECENT_SEARCH_MIN = 2
export const RECENT_SEARCH_MAX = 60

const parse = (raw: string | null): string[] => {
  if (!raw) {
    return []
  }
  try {
    const data: unknown = JSON.parse(raw)
    if (!Array.isArray(data)) {
      return []
    }
    return data
      .filter(
        (q): q is string =>
          typeof q === "string" &&
          q.length >= RECENT_SEARCH_MIN &&
          q.length <= RECENT_SEARCH_MAX
      )
      .slice(0, RECENT_SEARCHES_CAP)
  } catch {
    return []
  }
}

const write = (list: string[]): void => {
  try {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list))
  } catch {
    // storage unavailable (private mode, quota): recent searches are optional
  }
}

export const getRecentSearches = (): string[] => {
  try {
    return parse(window.localStorage.getItem(RECENT_SEARCHES_KEY))
  } catch {
    return []
  }
}

/** Returns the list after the add; invalid queries leave it unchanged. */
export const addRecentSearch = (q: string): string[] => {
  const query = q.trim()
  if (query.length < RECENT_SEARCH_MIN || query.length > RECENT_SEARCH_MAX) {
    return getRecentSearches()
  }
  const lower = query.toLowerCase()
  const next = [
    query,
    ...getRecentSearches().filter((x) => x.toLowerCase() !== lower),
  ].slice(0, RECENT_SEARCHES_CAP)
  write(next)
  return next
}

export const removeRecentSearch = (q: string): string[] => {
  const lower = q.trim().toLowerCase()
  const next = getRecentSearches().filter((x) => x.toLowerCase() !== lower)
  write(next)
  return next
}

export const clearRecentSearches = (): void => {
  try {
    window.localStorage.removeItem(RECENT_SEARCHES_KEY)
  } catch {
    // ignore
  }
}
