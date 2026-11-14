/** Reads `metadata.hold.reason`; absent or non-string values yield null. */
export const getHoldReason = (
  metadata?: Record<string, unknown> | null
): string | null => {
  const hold = metadata?.hold as { reason?: unknown } | null | undefined
  const reason = hold?.reason

  return typeof reason === "string" && reason.trim() ? reason : null
}

const HOLD_TAG_LABEL = "On hold"

/** An order is held when it carries the `On hold` tag or `metadata.hold`. */
export const isOrderHeld = (order: {
  tags?: { value?: string | null }[] | null
  metadata?: Record<string, unknown> | null
}): boolean =>
  !!order.tags?.some((tag) => tag?.value === HOLD_TAG_LABEL) ||
  !!order.metadata?.hold
