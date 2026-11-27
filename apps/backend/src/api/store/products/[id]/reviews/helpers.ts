export type PublicReview = {
  id: string
  rating: number
  title: string
  comment: string
  created_at: string
  author: string
}

export function toPublicReview(row: {
  id: string
  rating: number
  title: string
  comment: string
  created_at: string | Date
  customer?: { first_name?: string | null } | null
}): PublicReview {
  const first = row.customer?.first_name?.trim()
  return {
    id: row.id,
    rating: row.rating,
    title: row.title,
    comment: row.comment,
    created_at: new Date(row.created_at).toISOString(),
    author: first ? first : "Customer",
  }
}

export function toAverage(ratings: number[]): number | null {
  if (!ratings.length) {
    return null
  }
  const mean = ratings.reduce((a, b) => a + b, 0) / ratings.length
  return Math.round(mean * 10) / 10
}

function toInt(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") {
    return null
  }
  const n = Number(raw)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

export function clampLimit(raw: unknown): number {
  const n = toInt(raw)
  if (n === null) {
    return 10
  }
  return Math.min(50, Math.max(1, n))
}

export function clampOffset(raw: unknown): number {
  const n = toInt(raw)
  if (n === null) {
    return 0
  }
  return Math.max(0, n)
}
