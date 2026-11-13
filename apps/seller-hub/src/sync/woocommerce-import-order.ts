import { DeferSyncError, PermanentSyncError } from "../queue/queues.js"
import type { NormalizedWooOrder } from "../woocommerce/orders.js"
import {
  importClaimedOrder,
  type ImportAmazonOrderResult,
  type OrderImportAdapter,
  type OrderSyncClaim,
} from "./import-order.js"
import { PENDING_RECHECK_MS } from "./shopify-import-order.js"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import type { Pool } from "pg"

/** Only USD orders are imported (the Medusa store prices in USD). */
const IMPORT_CURRENCY = "USD"

/** Money is committed (or the merchant ships against it): import. */
const IMPORTABLE_STATUSES = new Set(["processing", "completed"])
/**
 * Not paid (yet): parked and re-checked (the webhook also re-enqueues). `failed`
 * is here, not skipped: a customer can retry payment and WooCommerce moves the
 * SAME order to `processing`; settling it as succeeded-with-no-order would make
 * the later delivery stop at the claim and lose a paid order.
 */
const DEFERRED_STATUSES = new Set(["pending", "on-hold", "failed"])
/**
 * Terminal: the sale did not (or no longer does) stand. Settled, not failed.
 * Known limitation: a cancelled order that is later re-opened is not imported.
 */
const SKIPPED_STATUSES = new Set(["cancelled", "refunded", "trash"])

/**
 * The WooCommerce specialisation of the shared claimed-import flow. The
 * sync_job `external_id` and the Medusa metadata value are both the numeric
 * WooCommerce order id as a string (e.g. "1042"), exactly as carried by the
 * queue job -- never the order number/key -- so the key is stable across
 * webhook redeliveries.
 */
export const woocommerceImportAdapter: OrderImportAdapter<NormalizedWooOrder> = {
  label: "WooCommerce order",
  metadataKey: "woocommerce_order_id",
  gate: (order, wooOrderId) => {
    const status = order.status.toLowerCase()
    if (SKIPPED_STATUSES.has(status)) {
      return `WooCommerce order ${wooOrderId} is ${status}; not imported`
    }
    if (DEFERRED_STATUSES.has(status)) {
      throw new DeferSyncError(
        `WooCommerce order ${wooOrderId} is "${status}" (not paid yet); ` +
          `will re-check later`,
        Date.now() + PENDING_RECHECK_MS
      )
    }
    if (!IMPORTABLE_STATUSES.has(status)) {
      throw new PermanentSyncError(
        `WooCommerce order ${wooOrderId} has unsupported status "${order.status}"`
      )
    }
    if (order.currencyCode.toUpperCase() !== IMPORT_CURRENCY) {
      throw new PermanentSyncError(
        `WooCommerce order ${wooOrderId} is in "${order.currencyCode}", only ` +
          `${IMPORT_CURRENCY} orders can be imported`
      )
    }
    // Fail a blank SKU explicitly rather than relying on "" never matching a
    // channel_listing row: nothing may be created for an unmappable line.
    if (order.items.some((item) => item.sku.trim() === "")) {
      throw new PermanentSyncError(
        `WooCommerce order ${wooOrderId} has a line item without a SKU; ` +
          `cannot map it to a StoreCentral variant`
      )
    }
    return null
  },
  lineItems: (order) => order.items,
  draftFields: (order, wooOrderId) => ({
    email: order.buyerEmail,
    shipping_address: order.shippingAddress,
    metadata: { woocommerce_order_id: wooOrderId },
  }),
}

export const importClaimedWooOrder = (
  wooOrderId: string,
  claim: Extract<OrderSyncClaim, { kind: "claimed" }>,
  loadContext: () => Promise<{
    order: NormalizedWooOrder
    salesChannelId: string
  }>,
  deps: {
    pool: Pool
    integrationAccountId: string
    medusaClient: MedusaAdminClient
  }
): Promise<ImportAmazonOrderResult> =>
  importClaimedOrder(wooOrderId, claim, loadContext, deps, woocommerceImportAdapter)
