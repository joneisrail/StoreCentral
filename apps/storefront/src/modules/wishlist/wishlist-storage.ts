export const WISHLIST_KEY = "sc-wishlist"

const MAX_ITEMS = 200

const cap = (ids: string[]) => ids.slice(-MAX_ITEMS)

export const parseWishlist = (raw: string | null): string[] => {
  if (!raw) {
    return []
  }

  try {
    const data: unknown = JSON.parse(raw)
    if (!Array.isArray(data)) {
      return []
    }
    const strings = data.filter((id): id is string => typeof id === "string")
    return cap(Array.from(new Set(strings)))
  } catch {
    return []
  }
}

export const toggleWishlist = (ids: string[], id: string): string[] =>
  ids.includes(id) ? ids.filter((x) => x !== id) : cap([...ids, id])

export const serializeWishlist = (ids: string[]): string => JSON.stringify(ids)
