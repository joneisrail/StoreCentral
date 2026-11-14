import { HttpTypes } from "@medusajs/types"

/**
 * The ship date to display. Fulfillments shipped by hand (mark shipped) keep
 * the user's chosen date in `metadata.shipped_at` (core stamps its own
 * `shipped_at` with the time of the click), so a valid metadata date wins.
 */
export const getFulfillmentShipDate = (
  fulfillment?: HttpTypes.AdminOrderFulfillment | null
): string | Date | undefined => {
  if (!fulfillment) {
    return undefined
  }
  const fromMetadata = (fulfillment.metadata as Record<string, unknown> | null)
    ?.shipped_at
  if (
    typeof fromMetadata === "string" &&
    !Number.isNaN(new Date(fromMetadata).getTime())
  ) {
    return fromMetadata
  }
  return fulfillment.shipped_at ?? undefined
}
