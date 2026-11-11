
export const DAY_MS = 24 * 60 * 60 * 1000
export const MAX_RANGE_DAYS = 366
export const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
export const PRESETS = [7, 30, 90] as const
export const DEFAULT_PRESET = 30

export const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export function presetRange(days: number) {
  const now = new Date()
  const todayMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  )
  return { from: isoDay(todayMs - (days - 1) * DAY_MS), to: isoDay(todayMs) }
}

export function parseDay(value: string): number | null {
  const match = DATE_RE.exec(value)
  if (!match) {
    return null
  }
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(ms) || isoDay(ms) !== value ? null : ms
}

// Mirrors resolveRange on the server: both ends inclusive, from <= to, at
// most 366 days.
export function validateRange(from: string, to: string): string | null {
  const fromMs = parseDay(from)
  const toMs = parseDay(to)
  if (fromMs === null || toMs === null) {
    return "Enter a valid from and to date."
  }
  if (fromMs > toMs) {
    return "The from date must not be after the to date."
  }
  if ((toMs - fromMs) / DAY_MS + 1 > MAX_RANGE_DAYS) {
    return `The date range must be at most ${MAX_RANGE_DAYS} days.`
  }
  return null
}

