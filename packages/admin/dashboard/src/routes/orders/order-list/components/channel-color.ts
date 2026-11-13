export type ChannelColor =
  "blue" | "green" | "orange" | "purple" | "red" | "grey"

const COLORS: ChannelColor[] = [
  "blue",
  "green",
  "orange",
  "purple",
  "red",
  "grey",
]

/**
 * Maps a sales channel name onto a Badge colour with a stable (FNV-1a) hash
 * of the lowercased, trimmed name, so the same channel always gets the same
 * colour regardless of casing or surrounding whitespace.
 */
export const getChannelColor = (name: string): ChannelColor => {
  const normalized = (name ?? "").trim().toLowerCase()

  let hash = 0x811c9dc5
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return COLORS[hash % COLORS.length]
}
