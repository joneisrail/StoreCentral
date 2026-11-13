import type { Pool } from "pg"
import type { Queue } from "bullmq"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import { applyPriceRule, type PriceRule } from "./push-price.js"

export const RECONCILE_WOOCOMMERCE_JOB = "reconcile-woocommerce"

export type ReconcileWooCommerceDeps = {
  pool: Pool
  medusaClient: MedusaAdminClient
  integrationAccountId: string
  inventoryQueue: Queue
  priceQueue: Queue
  orderQueue: Queue
  fetchOrdersSince: (sinceIso: string) => Promise<{ wooOrderId: string }[]>
}

type ChannelListingRow = {
  id: string
  medusa_variant_id: string
  price_rule: PriceRule | null
  last_synced_quantity: number | null
  // NUMERIC comes back from `pg` as a string.
  last_synced_price: string | null
}

// Widens the order query so a store-timezone or clock skew cannot hide orders
// at the watermark edge. Re-enqueueing is harmless (job ids collapse, import
// is idempotent); the watermark itself still advances to the scan start.
const CATCH_UP_OVERLAP_MS = 15 * 60 * 1000
const FIRST_SCAN_LOOKBACK_MS = 24 * 60 * 60 * 1000

/**
 * WooCommerce counterpart of `reconcileShopify`: requeues stock/price drift
 * (against the post-rule `last_synced_*` baseline, same quantity clamp as
 * `pushWooInventory`) and re-enqueues WooCommerce orders modified since the
 * account's `last_synced_at` (24h back when null) using the webhook's job
 * data/id/options so duplicates collapse. It never writes to Medusa or
 * WooCommerce and never calls the push functions. A NULL baseline counts as
 * drift. `last_synced_at` advances to the scan start once the order catch-up
 * succeeded, regardless of per-listing check failures.
 */
export const reconcileWooCommerce = async (
  deps: ReconcileWooCommerceDeps
): Promise<{
  inventoryRequeued: number
  priceRequeued: number
  ordersRequeued: number
  failedChecks: number
}> => {
  const {
    pool,
    medusaClient,
    integrationAccountId,
    inventoryQueue,
    priceQueue,
    orderQueue,
    fetchOrdersSince,
  } = deps

  const scanStartedAt = new Date()

  const { rows } = await pool.query<ChannelListingRow>(
    `SELECT id, medusa_variant_id, price_rule, last_synced_quantity, last_synced_price
     FROM seller_hub.channel_listing
     WHERE integration_account_id = $1
     ORDER BY created_at, id`,
    [integrationAccountId]
  )
  const { rows: accountRows } = await pool.query<{ last_synced_at: Date | null }>(
    `SELECT last_synced_at FROM seller_hub.integration_account WHERE id = $1`,
    [integrationAccountId]
  )
  const lastSyncedAt = accountRows[0]?.last_synced_at ?? null
  const since = lastSyncedAt
    ? new Date(lastSyncedAt)
    : new Date(scanStartedAt.getTime() - FIRST_SCAN_LOOKBACK_MS)

  let inventoryRequeued = 0
  let priceRequeued = 0
  let ordersRequeued = 0
  let failedChecks = 0

  const runCheck = async (
    row: ChannelListingRow,
    kind: "inventory" | "price",
    check: () => Promise<void>
  ): Promise<void> => {
    try {
      await check()
    } catch (err) {
      failedChecks++
      console.error(
        `[reconcile-woocommerce] ${kind} check failed for channel_listing ${row.id} ` +
          `(variant ${row.medusa_variant_id}); skipping it this run:`,
        err
      )
    }
  }

  for (const row of rows) {
    // NULL baseline = never pushed: StoreCentral is the master, so push it.
    if (row.last_synced_quantity === null) {
      await runCheck(row, "inventory", async () => {
        await inventoryQueue.add("reconcile", { channelListingId: row.id })
        inventoryRequeued++
      })
    } else {
      await runCheck(row, "inventory", async () => {
        const inventory = await medusaClient.getVariantInventory(
          row.medusa_variant_id
        )
        // Same clamp as pushWooInventory, so a clamped value is not drift.
        const current = Number.isFinite(inventory.quantity)
          ? Math.max(0, Math.floor(inventory.quantity))
          : 0
        if (current !== row.last_synced_quantity) {
          await inventoryQueue.add("reconcile", { channelListingId: row.id })
          inventoryRequeued++
        }
      })
    }

    if (row.last_synced_price === null) {
      await runCheck(row, "price", async () => {
        await priceQueue.add("reconcile", { channelListingId: row.id })
        priceRequeued++
      })
    } else {
      await runCheck(row, "price", async () => {
        const pricing = await medusaClient.getVariantPricing(
          row.medusa_variant_id
        )
        if (pricing.currencyCode.toLowerCase() !== "usd") {
          throw new Error(
            `Medusa price for variant ${row.medusa_variant_id} is in ${pricing.currencyCode}; only USD is supported for WooCommerce`
          )
        }
        // last_synced_price is the post-rule amount, so compare post-rule.
        const expectedAmount = applyPriceRule(pricing.amount, row.price_rule)
        if (expectedAmount !== Number(row.last_synced_price)) {
          await priceQueue.add("reconcile", { channelListingId: row.id })
          priceRequeued++
        }
      })
    }
  }

  let ordersFetched = true
  try {
    const orders = await fetchOrdersSince(
      new Date(since.getTime() - CATCH_UP_OVERLAP_MS).toISOString()
    )
    for (const order of orders) {
      const id = order.wooOrderId
      if (!/^\d+$/.test(id)) {
        throw new Error(`unexpected WooCommerce order id "${id}"`)
      }
      // Same data, job id and options as the webhook, so duplicates collapse.
      await orderQueue.add(
        "reconcile",
        { wooOrderId: id },
        {
          jobId: `woocommerce-order-${id}`,
          removeOnComplete: true,
          removeOnFail: true,
        }
      )
      ordersRequeued++
    }
  } catch (err) {
    ordersFetched = false
    console.error("[reconcile-woocommerce] missed-order catch-up failed:", err)
  }

  // Watermark depends only on the order scan, never on listing checks.
  if (ordersFetched) {
    await pool.query(
      `UPDATE seller_hub.integration_account
       SET last_synced_at = $1, updated_at = now()
       WHERE id = $2`,
      [scanStartedAt, integrationAccountId]
    )
  }

  return { inventoryRequeued, priceRequeued, ordersRequeued, failedChecks }
}
