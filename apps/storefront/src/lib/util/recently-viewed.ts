export const RECENT_KEY = "sc-recently-viewed"
export const RECENT_CAP = 12

export const parseRecent = (raw: string | null): string[] => {
  if (!raw) {
    return []
  }

  try {
    const data: unknown = JSON.parse(raw)
    if (!Array.isArray(data)) {
      return []
    }
    const strings = data.filter((id): id is string => typeof id === "string")
    return Array.from(new Set(strings)).slice(0, RECENT_CAP)
  } catch {
    return []
  }
}

export const addRecent = (list: string[], id: string): string[] =>
  [id, ...list.filter((x) => x !== id)].slice(0, RECENT_CAP)

export const readRecent = (): string[] => {
  try {
    return parseRecent(window.localStorage.getItem(RECENT_KEY))
  } catch {
    return []
  }
}

export const writeRecent = (list: string[]): void => {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    // storage unavailable (private mode, quota): recently viewed is optional
  }
}
