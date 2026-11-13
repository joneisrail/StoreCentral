export type DueStatus = {
  kind: "overdue" | "today" | "tomorrow" | "days"
  days?: number
}

const DAY_MS = 24 * 60 * 60 * 1000

const getDayNumber = (date: Date, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date)

  const pick = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value)

  return Math.round(
    Date.UTC(pick("year"), pick("month") - 1, pick("day")) / DAY_MS
  )
}

/**
 * Buckets a ship-by deadline relative to `now`: overdue once `now` is past
 * the deadline, otherwise by CALENDAR days in `timeZone` (so a deadline just
 * after local midnight is "tomorrow", not "today").
 */
export const getDueStatus = (
  deadline: Date | null,
  now: Date,
  timeZone: string
): DueStatus | null => {
  if (!deadline || Number.isNaN(deadline.getTime())) {
    return null
  }

  if (now.getTime() > deadline.getTime()) {
    return { kind: "overdue" }
  }

  const diff = getDayNumber(deadline, timeZone) - getDayNumber(now, timeZone)

  if (diff <= 0) {
    return { kind: "today" }
  }

  if (diff === 1) {
    return { kind: "tomorrow" }
  }

  return { kind: "days", days: diff }
}
