import { DeferSyncError, PermanentSyncError } from "../queue/queues.js"
import type { NormalizedShopifyOrder } from "../shopify/orders.js"
import {
  importClaimedOrder,
  type ImportAmazonOrderResult,
  type OrderImportAdapter,
  type OrderSyncClaim,
} from "./import-order.js"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import type { Pool } from "pg"

/** Only USD orders are imported (the Medusa store prices in USD). */
const IMPORT_CURRENCY = "USD"

/**
 * How long a `PENDING` order is parked before it is looked at again. The
 * Shopify webhook for the paid order also enqueues a fresh job, so this is a
 * backstop for a missed webhook, not the primary path.
 */
export const PENDING_RECHECK_MS = 30 * 60 * 1000

/**
 * Financial statuses whose money is (at least partly) committed, so the order
 * is imported: PAID, PARTIALLY_PAID, AUTHORIZED (card authorised, capture
 * pending -- the merchant ships against it) and PARTIALLY_REFUNDED (it was
 * paid; a later partial refund does not un-sell it).
 */
const IMPORTABLE_STATUSES = new Set([
  "PAID",
  "PARTIALLY_PAID",
  "AUTHORIZED",
  "PARTIALLY_REFUNDED",
])
/** Terminal: the sale did not (or no longer does) stand. Settled, not failed. */
const SKIPPED_STATUSES = new Set(["VOIDED", "REFUNDED", "EXPIRED"])

/**
 * The Shopify specialisation of the shared claimed-import flow. The
 * sync_job `external_id` and the Medusa metadata value are both the order's
 * GraphQL id (`gid://shopify/Order/<n>`), exactly as carried by the queue
 * job -- never the display name -- so the key is stable across redeliveries.
 */
export const shopifyImportAdapter: OrderImportAdapter<NormalizedShopifyOrder> = {
  label: "Shopify order",
  marketplace: "shopify",
  metadataKey: "shopify_order_id",
  accountMetadataKey: "shopify_account_id",
  gate: (order, shopifyOrderId) => {
    if (order.cancelledAt) {
      return `Shopify order ${shopifyOrderId} is cancelled; not imported`
    }
    const status = order.financialStatus.toUpperCase()
    if (SKIPPED_STATUSES.has(status)) {
      return `Shopify order ${shopifyOrderId} is ${status}; not imported`
    }
    if (status === "PENDING") {
      throw new DeferSyncError(
        `Shopify order ${shopifyOrderId} is still PENDING payment; will ` +
          `re-check later`,
        Date.now() + PENDING_RECHECK_MS
      )
    }
    if (!IMPORTABLE_STATUSES.has(status)) {
      throw new PermanentSyncError(
        `Shopify order ${shopifyOrderId} has unsupported financial status ` +
          `"${order.financialStatus}"`
      )
    }
    if (order.currencyCode.toUpperCase() !== IMPORT_CURRENCY) {
      throw new PermanentSyncError(
        `Shopify order ${shopifyOrderId} is in "${order.currencyCode}", only ` +
          `${IMPORT_CURRENCY} orders can be imported`
      )
    }
    if (order.lineItemsTruncated) {
      throw new PermanentSyncError(
        `Shopify order ${shopifyOrderId} has more than 100 line items; ` +
          `refusing to import a truncated order`
      )
    }
    return null
  },
  lineItems: (order) => order.items,
  draftFields: (order, shopifyOrderId) => ({
    email: order.buyerEmail,
    shipping_address: order.shippingAddress,
    metadata: {
      shopify_order_id: shopifyOrderId,
      shopify_order_name: order.orderName,
    },
  }),
}

export const importClaimedShopifyOrder = (
  shopifyOrderId: string,
  claim: Extract<OrderSyncClaim, { kind: "claimed" }>,
  loadContext: () => Promise<{
    order: NormalizedShopifyOrder
    salesChannelId: string
  }>,
  deps: {
    pool: Pool
    integrationAccountId: string
    medusaClient: MedusaAdminClient
  }
): Promise<ImportAmazonOrderResult> =>
  importClaimedOrder(
    shopifyOrderId,
    claim,
    loadContext,
    deps,
    shopifyImportAdapter
  )
