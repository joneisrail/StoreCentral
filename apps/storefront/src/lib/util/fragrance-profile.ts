const MAX_NOTES = 30

export type FragranceProfile = {
  family: string | null
  gender: string | null
  concentration: string | null
  top: string[]
  middle: string[]
  base: string[]
  isEmpty: boolean
}

/**
 * Reads a list-like value (string, comma-separated string or array) into
 * clean, de-duplicated notes, capped at 30.
 */
export const toNoteList = (value: unknown): string[] => {
  let items: unknown[] = []

  if (typeof value === "string") {
    items = value.split(",")
  } else if (Array.isArray(value)) {
    items = value
  }

  const seen = new Set<string>()
  const result: string[] = []

  for (const item of items) {
    if (typeof item !== "string") {
      continue
    }
    const note = item.replace(/\s+/g, " ").trim()
    const key = note.toLowerCase()
    if (note && !seen.has(key)) {
      seen.add(key)
      result.push(note)
    }
  }

  return result.slice(0, MAX_NOTES)
}

export const toBrandName = (product: {
  categories?: Array<{
    name?: string | null
    parent_category?: { handle?: string | null } | null
  } | null> | null
}): string | null => {
  const brand = (product.categories ?? []).find(
    (category) =>
      category?.parent_category?.handle === "brands" &&
      Boolean(category.name?.trim()),
  )

  return brand?.name?.trim() || null
}

// Strings, comma-separated strings and arrays all read as a ", " joined text.
const toText = (value: unknown): string | null => {
  const items = toNoteList(value)
  return items.length > 0 ? items.join(", ") : null
}

export const toFragranceProfile = (product: {
  metadata?: Record<string, unknown> | null
}): FragranceProfile => {
  const metadata = product.metadata ?? {}
  const family = toText(metadata.fragrance_family)
  const gender = toText(metadata.gender)
  const concentration = toText(metadata.concentration)
  const top = toNoteList(metadata.top_notes)
  const middle = toNoteList(metadata.middle_notes)
  const base = toNoteList(metadata.base_notes)

  return {
    family,
    gender,
    concentration,
    top,
    middle,
    base,
    isEmpty:
      !family &&
      !gender &&
      !concentration &&
      top.length + middle.length + base.length === 0,
  }
}
