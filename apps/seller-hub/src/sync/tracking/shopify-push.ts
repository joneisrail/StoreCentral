import { PermanentSyncError } from "../../queue/queues.js"
import type { ShopifyClient } from "../../shopify/client.js"
import { coversWholeOrder } from "./coverage.js"
import type { TrackingPush } from "./types.js"

/*
 * Shopify Admin GraphQL names used here, all in one place. UNVERIFIED against
 * a real store: written from the Admin API 2026-10 documentation as understood
 * (`fulfillmentCreateV2` was folded into `fulfillmentCreate`).
 */
const OPEN_STATUSES = new Set(["OPEN", "IN_PROGRESS"])
const ORDER_GID_PREFIX = "gid://shopify/Order/"

const LOOKUP_QUERY = `query TrackingFulfillmentOrders($id: ID!) {
  order(id: $id) {
    fulfillments { trackingInfo { number } }
    fulfillmentOrders(first: 20) {
      pageInfo { hasNextPage }
      nodes {
        id
        status
        lineItems(first: 50) {
          pageInfo { hasNextPage }
          nodes { id sku remainingQuantity }
        }
      }
    }
  }
}`

const FULFILL_MUTATION = `mutation TrackingFulfillmentCreate($fulfillment: FulfillmentInput!) {
  fulfillmentCreate(fulfillment: $fulfillment) {
    fulfillment { id }
    userErrors { field message }
  }
}`

/** userError messages that mean "try again later" rather than "bad input". */
const TRANSIENT_USER_ERROR = /throttl|internal error|try again|timed? ?out|temporar|not in a fulfillable state|quantity|already fulfilled|cannot be fulfilled/i

type FoLine = { id: string; sku: string | null; remainingQuantity: number }
type LookupResult = {
  order: {
    fulfillments: { trackingInfo: { number: string | null }[] }[] | null
    fulfillmentOrders: {
      pageInfo?: { hasNextPage?: boolean }
      nodes: {
        id: string
        status: string
        lineItems: { pageInfo?: { hasNextPage?: boolean }; nodes: FoLine[] }
      }[]
    }
  } | null
}
type CreateResult = {
  fulfillmentCreate: {
    fulfillment?: { id?: string } | null
    userErrors: { field?: string[] | null; message?: string }[]
  } | null
}

const normSku = (sku: string | null | undefined): string =>
  (sku ?? "").trim().toLowerCase()

const toOrderGid = (externalOrderId: string): string => {
  const id = externalOrderId.trim()
  if (id.startsWith(ORDER_GID_PREFIX) && /^\d+$/.test(id.slice(ORDER_GID_PREFIX.length))) {
    return id
  }
  if (/^\d+$/.test(id)) return `${ORDER_GID_PREFIX}${id}`
  throw new PermanentSyncError("Shopify order id is not a numeric id or order gid")
}

type Selection = Map<string, { id: string; quantity: number }[]>

/**
 * Pushes a Medusa shipment's tracking to Shopify by creating a fulfillment on
 * the order's open fulfillment orders. Errors carry no tracking data.
 */
export const createShopifyTrackingPush =
  (client: ShopifyClient): TrackingPush =>
  async ({ order, fulfillment, externalOrderId, noNotification }) => {
    const orderGid = toOrderGid(externalOrderId)
    const label = fulfillment.labels[0]
    if (!label) return "skipped"
    const trackingNumber = label.trackingNumber.trim()
    if (!trackingNumber) throw new PermanentSyncError("Shopify tracking number is blank")

    const found = await client.graphql<LookupResult>(LOOKUP_QUERY, { id: orderGid })
    const shopOrder = found?.order
    if (!shopOrder) return "skipped"

    // A retry after a lost success record must not fulfil twice.
    const already = (shopOrder.fulfillments ?? []).some((f) =>
      (f.trackingInfo ?? []).some((t) => (t.number ?? "").trim() === trackingNumber)
    )
    if (already) return "skipped"

    const fos = shopOrder.fulfillmentOrders
    if (
      fos.pageInfo?.hasNextPage ||
      fos.nodes.some((n) => n.lineItems.pageInfo?.hasNextPage)
    ) {
      throw new Error("Shopify fulfillment orders exceed the page limit")
    }

    const openOrders = shopOrder.fulfillmentOrders.nodes.filter((n) =>
      OPEN_STATUSES.has(n.status)
    )
    const remainingLines = (fo: (typeof openOrders)[number]) =>
      fo.lineItems.nodes.filter((l) => l.remainingQuantity > 0)
    if (openOrders.every((fo) => remainingLines(fo).length === 0)) return "skipped"

    const allRemaining = (): Selection => {
      const sel: Selection = new Map()
      for (const fo of openOrders) {
        const lines = remainingLines(fo).map((l) => ({
          id: l.id,
          quantity: l.remainingQuantity,
        }))
        if (lines.length > 0) sel.set(fo.id, lines)
      }
      return sel
    }

    // Wanted quantity per SKU from the Medusa fulfillment.
    const itemById = new Map(order.items.map((i) => [i.id, i]))
    const wanted = new Map<string, number>()
    for (const fi of fulfillment.items) {
      const sku = normSku(itemById.get(fi.lineItemId)?.sku)
      if (!sku) continue
      wanted.set(sku, (wanted.get(sku) ?? 0) + fi.quantity)
    }
    const wholeOrder = coversWholeOrder(order.items, fulfillment.items)

    let selection: Selection = new Map()
    if (!wholeOrder) {
      for (const fo of openOrders) {
        const lines: { id: string; quantity: number }[] = []
        for (const l of remainingLines(fo)) {
          const sku = normSku(l.sku)
          const left = wanted.get(sku)
          if (!sku || !left || left <= 0) continue
          const quantity = Math.min(l.remainingQuantity, left)
          wanted.set(sku, left - quantity)
          lines.push({ id: l.id, quantity })
        }
        if (lines.length > 0) selection.set(fo.id, lines)
      }
    }
    if (wholeOrder) selection = allRemaining()
    if (selection.size === 0) {
      // Never silently drop tracking: record the failure for follow-up.
      throw new PermanentSyncError("no matching Shopify lines")
    }

    const trackingInfo: { company?: string; number: string; url?: string } = {
      number: trackingNumber,
    }
    if (fulfillment.carrier) trackingInfo.company = fulfillment.carrier
    if (label.trackingUrl) trackingInfo.url = label.trackingUrl

    const result = await client.graphql<CreateResult>(FULFILL_MUTATION, {
      fulfillment: {
        notifyCustomer: !noNotification,
        trackingInfo,
        lineItemsByFulfillmentOrder: [...selection].map(([fulfillmentOrderId, items]) => ({
          fulfillmentOrderId,
          fulfillmentOrderLineItems: items,
        })),
      },
    })

    const payload = result?.fulfillmentCreate
    if (!payload) throw new Error("Shopify fulfillmentCreate returned no result")
    const userErrors = payload.userErrors ?? []
    if (userErrors.length > 0) {
      // Generic messages only: Shopify's text may echo the tracking data.
      if (userErrors.some((e) => TRANSIENT_USER_ERROR.test(e.message ?? ""))) {
        throw new Error("Shopify fulfillmentCreate temporarily failed")
      }
      throw new PermanentSyncError("Shopify rejected fulfillmentCreate")
    }
    if (!payload.fulfillment?.id) {
      throw new Error("Shopify fulfillmentCreate returned no fulfillment")
    }
    return "pushed"
  }
