export type TrackingTarget = {
  marketplace: "shopify" | "woocommerce" | "amazon"
  accountId: string
  externalOrderId: string
}

// Metadata keys written by the import adapters (accountMetadataKey / metadataKey).
const TARGET_KEYS = [
  { marketplace: "shopify", account: "shopify_account_id", order: "shopify_order_id" },
  { marketplace: "woocommerce", account: "woocommerce_account_id", order: "woocommerce_order_id" },
  { marketplace: "amazon", account: "amazon_account_id", order: "amazon_order_id" },
] as const

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0

/**
 * Which marketplace order (and which connected account) a Medusa order was
 * imported from, or null for manual/web orders and orders imported before
 * account scoping (no account metadata).
 */
export const resolveTrackingTarget = (
  metadata: Record<string, unknown> | null | undefined
): TrackingTarget | null => {
  if (!metadata) return null
  for (const k of TARGET_KEYS) {
    const accountId = metadata[k.account]
    const externalOrderId = metadata[k.order]
    if (nonEmpty(accountId) && nonEmpty(externalOrderId)) {
      return { marketplace: k.marketplace, accountId, externalOrderId }
    }
  }
  return null
}
