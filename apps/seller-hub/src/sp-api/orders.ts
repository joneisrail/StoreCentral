import type { SpApiClient } from "./client.js"
import type { NormalizedAmazonOrder } from "../sync/types.js"

// Rate limit verified against Amazon's published Orders API rate-limit
// table (developer-docs.amazon.com/sp-api/docs/orders-api-rate-limits):
// `getOrder` is 0.5 requests/second with a burst of 30. This replaces the
// plan's draft value (0.0167 req/s, burst 20), which is actually the
// documented rate for the list-orders `getOrders` operation, not the
// single-order `getOrder` operation this file calls -- the draft mixed the
// two up. No test asserts the exact rate-limit values (they only affect
// request pacing, not this function's return value), so this correction is
// safe to make without touching `orders.test.ts`.
const GET_ORDER_RATE_LIMIT = { ratePerSecond: 0.5, burst: 30 }

type RawSpApiOrder = {
  AmazonOrderId: string
  BuyerInfo?: { BuyerEmail?: string }
  ShippingAddress?: {
    Name?: string
    AddressLine1?: string
    City?: string
    CountryCode?: string
    PostalCode?: string
  }
  OrderItems?: { SellerSKU: string; QuantityOrdered: number }[]
}

/**
 * Fetches a single Amazon order via the SP-API Orders API and maps it into
 * the `NormalizedAmazonOrder` shape Task 6's `importAmazonOrder` expects.
 *
 * Field mapping (`BuyerInfo.BuyerEmail`, `ShippingAddress.*`,
 * `OrderItems[].SellerSKU`/`QuantityOrdered`) follows the SP-API v0 Orders
 * API's documented `Order` schema shape. One real discrepancy from that
 * schema, carried over deliberately from this task's brief/tests: the real
 * `getOrder` operation returns the `Order` object *without* line items --
 * `OrderItems` only comes back from the separate `getOrderItems` operation
 * (a paginated call keyed by `AmazonOrderId`). This function's test fixture
 * (and the brief itself) models a single response that already includes
 * `OrderItems`, so that's what's implemented here; wiring a second
 * `getOrderItems` call is left for whoever integrates this against real
 * SP-API traffic (Task 13's manual smoke checklist, per the brief), since
 * this task has no live-Amazon test to drive that split out.
 *
 * `ShippingAddress.Name` is a single "First Last" string in SP-API; it's
 * split here on the first space into `first_name`/`last_name` (remaining
 * words, if any, stay in `last_name`) since Medusa's address shape wants
 * them separate and SP-API gives no better signal to split on.
 */
export const getOrder = async (
  client: SpApiClient,
  amazonOrderId: string
): Promise<NormalizedAmazonOrder> => {
  const order = await client.request<RawSpApiOrder>({
    name: "getOrder",
    method: "GET",
    path: `/orders/v0/orders/${amazonOrderId}`,
    rateLimit: GET_ORDER_RATE_LIMIT,
  })

  const { firstName, lastName } = splitName(order.ShippingAddress?.Name ?? "")

  return {
    amazonOrderId: order.AmazonOrderId,
    buyerEmail: order.BuyerInfo?.BuyerEmail ?? "",
    items: (order.OrderItems ?? []).map((item) => ({
      sku: item.SellerSKU,
      quantity: item.QuantityOrdered,
    })),
    shippingAddress: {
      first_name: firstName,
      last_name: lastName,
      address_1: order.ShippingAddress?.AddressLine1 ?? "",
      city: order.ShippingAddress?.City ?? "",
      country_code: (order.ShippingAddress?.CountryCode ?? "").toLowerCase(),
      postal_code: order.ShippingAddress?.PostalCode ?? "",
    },
  }
}

const splitName = (fullName: string): { firstName: string; lastName: string } => {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) {
    return { firstName: "", lastName: "" }
  }
  const [firstName, ...rest] = parts
  return { firstName: firstName!, lastName: rest.join(" ") }
}
