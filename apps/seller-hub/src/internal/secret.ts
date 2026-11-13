const MIN_LENGTH = 16

/** Decides whether the internal API may be enabled. Never logs or returns the raw value on failure. */
export function resolveInternalSecret(raw: string | undefined): {
  secret: string | null
  reason?: "unset" | "too_short"
} {
  const trimmed = raw?.trim() ?? ""
  if (!trimmed) return { secret: null, reason: "unset" }
  if (trimmed.length < MIN_LENGTH) return { secret: null, reason: "too_short" }
  return { secret: trimmed }
}
