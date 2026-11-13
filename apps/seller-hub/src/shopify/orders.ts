import { PermanentSyncError } from "../queue/queues.js"
import type { ShopifyClient } from "./client.js"

export type NormalizedShopifyOrder = {
  shopifyOrderId: string
  orderName: string
  financialStatus: string
  /** ISO currency of `items[].unitPrice` (shop money). "" if Shopify omitted it. */
  currencyCode: string
  /**
   * True when the order has more line items than one `lineItems(first: 100)`
   * page returned, i.e. `items` is incomplete. The importer fails such an
   * order permanently rather than importing a truncated one; it is a flag
   * (not a throw) so one oversized order cannot abort a whole polling batch.
   */
  lineItemsTruncated: boolean
  cancelledAt: string | null
  buyerEmail: string
  items: { sku: string; quantity: number; unitPrice: number }[]
  shippingAddress: {
    first_name: string
    last_name: string
    address_1: string
    city: string
    country_code: string
    postal_code: string
  }
}

const ORDER_FIELDS = `
  id name displayFinancialStatus currencyCode cancelledAt email
  shippingAddress { firstName lastName address1 city countryCodeV2 zip }
  lineItems(first: 100) {
    pageInfo { hasNextPage }
    nodes {
      sku quantity
      discountedUnitPriceSet { shopMoney { amount currencyCode } }
    }
  }
`

const ORDERS_QUERY = `
  query Orders($query: String!, $after: String) {
    orders(first: 50, after: $after, query: $query) {
      nodes { ${ORDER_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
`

const ORDER_QUERY = `
  query Order($id: ID!) {
    order(id: $id) { ${ORDER_FIELDS} }
  }
`

const bad = (what: string): never => {
  throw new PermanentSyncError(`Malformed Shopify order: ${what}`)
}

const str = (v: unknown): string => (typeof v === "string" ? v : "")

/**
 * Normalizes an Admin GraphQL order node. Only `lineItems` become items, so
 * shipping and tax lines never do; a line without a SKU is kept with
 * `sku: ""` so the importer can fail it cleanly.
 */
export const normalizeShopifyOrder = (raw: unknown): NormalizedShopifyOrder => {
  if (typeof raw !== "object" || raw === null) return bad("not an object")
  const o = raw as Record<string, any>

  if (typeof o.id !== "string" || o.id === "") return bad("missing id")
  if (typeof o.name !== "string" || o.name === "") return bad("missing name")
  const nodes = o.lineItems?.nodes
  if (!Array.isArray(nodes)) return bad("missing line items")

  const items = nodes.map((n: any) => {
    const quantity = n?.quantity
    const amount = n?.discountedUnitPriceSet?.shopMoney?.amount
    const unitPrice = typeof amount === "string" ? Number(amount) : NaN
    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      !Number.isFinite(unitPrice)
    ) {
      return bad("invalid line item")
    }
    return { sku: str(n.sku).trim(), quantity, unitPrice }
  })

  const currencyCode =
    str(o.currencyCode) ||
    str(nodes[0]?.discountedUnitPriceSet?.shopMoney?.currencyCode)

  const a = o.shippingAddress ?? {}
  return {
    shopifyOrderId: o.id,
    orderName: o.name,
    financialStatus: str(o.displayFinancialStatus),
    currencyCode,
    lineItemsTruncated: o.lineItems?.pageInfo?.hasNextPage === true,
    cancelledAt: typeof o.cancelledAt === "string" ? o.cancelledAt : null,
    buyerEmail: str(o.email),
    items,
    shippingAddress: {
      first_name: str(a.firstName),
      last_name: str(a.lastName),
      address_1: str(a.address1),
      city: str(a.city),
      country_code: str(a.countryCodeV2),
      postal_code: str(a.zip),
    },
  }
}

export const fetchShopifyOrdersSince = async (
  client: ShopifyClient,
  sinceIso: string
): Promise<NormalizedShopifyOrder[]> => {
  type Page = {
    orders: {
      nodes: unknown[]
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
    }
  }
  const out: NormalizedShopifyOrder[] = []
  let after: string | null = null
  while (true) {
    const data: Page = await client.graphql<Page>(ORDERS_QUERY, {
      query: `updated_at:>=${sinceIso}`,
      after,
    })
    for (const n of data.orders.nodes) out.push(normalizeShopifyOrder(n))
    const { hasNextPage, endCursor } = data.orders.pageInfo
    if (!hasNextPage || !endCursor) return out
    after = endCursor
  }
}

/** Fetches and normalizes a single order by its GraphQL id. */
export const fetchShopifyOrder = async (
  client: ShopifyClient,
  shopifyOrderId: string
): Promise<NormalizedShopifyOrder> => {
  const data = await client.graphql<{ order: unknown }>(ORDER_QUERY, {
    id: shopifyOrderId,
  })
  if (!data.order) {
    throw new PermanentSyncError(`Shopify order ${shopifyOrderId} not found`)
  }
  return normalizeShopifyOrder(data.order)
}
