/** Reads `metadata.hold.reason`; absent or non-string values yield null. */
export const getHoldReason = (
  metadata?: Record<string, unknown> | null
): string | null => {
  const hold = metadata?.hold as { reason?: unknown } | null | undefined
  const reason = hold?.reason

  return typeof reason === "string" && reason.trim() ? reason : null
}
