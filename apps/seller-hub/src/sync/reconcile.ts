import type { Pool } from "pg"
import type { Queue } from "bullmq"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import { applyPriceRule, type PriceRule } from "./push-price.js"

export type ReconcileDeps = {
  pool: Pool
  medusaClient: MedusaAdminClient
  integrationAccountId: string
  inventoryQueue: Queue
  priceQueue: Queue
}

type ChannelListingRow = {
  id: string
  medusa_variant_id: string
  price_rule: PriceRule | null
  last_synced_quantity: number | null
  // NUMERIC columns come back from `pg` as strings (to avoid silent
  // precision loss), not numbers -- see the `Number(...)` conversion below.
  last_synced_price: string | null
}

/**
 * Scans every `channel_listing` row belonging to `integrationAccountId` for
 * drift between Medusa's *current* inventory/price and what was *last
 * successfully pushed* to Amazon -- recorded on the row itself as
 * `last_synced_quantity`/`last_synced_price` by Task 8's
 * `pushInventoryUpdate`/`pushPriceUpdate` on their last successful run (see
 * `db/schema.ts`'s Task 11 comment for why this, rather than re-fetching
 * Amazon's own current state, is the baseline).
 *
 * A listing that has never been successfully pushed (both columns still
 * `NULL`) has no baseline to compare against, so it's skipped rather than
 * treated as drifted.
 *
 * For price, the comparison applies the listing's `price_rule` to Medusa's
 * current price first (via `applyPriceRule`, the same function
 * `pushPriceUpdate` itself uses) -- `last_synced_price` is the *post-rule*
 * amount that was actually submitted to Amazon, so comparing it against
 * Medusa's raw price would flag every rule-marked-up listing as "drifted"
 * even when nothing has changed.
 *
 * Each drift enqueues a corrective job on the matching queue -- keyed by
 * `channelListingId`, the same identifier `pushInventoryUpdate`/
 * `pushPriceUpdate` take as input -- rather than calling those functions
 * directly, so the correction goes through the same BullMQ retry/backoff
 * and idempotent `sync_job` tracking as the webhook-triggered flow.
 */
export const reconcile = async (
  deps: ReconcileDeps
): Promise<{ driftFound: number; failedChecks: number }> => {
  const { pool, medusaClient, integrationAccountId, inventoryQueue, priceQueue } =
    deps

  const { rows } = await pool.query<ChannelListingRow>(
    `SELECT id, medusa_variant_id, price_rule, last_synced_quantity, last_synced_price
     FROM seller_hub.channel_listing
     WHERE integration_account_id = $1
     ORDER BY created_at, id`,
    [integrationAccountId]
  )

  let driftFound = 0
  let failedChecks = 0

  // Each check is isolated in its own try/catch: one listing whose Medusa
  // variant was deleted, or has no price set, must not abort the scan for
  // every listing after it. Without this, such a row throws on *every*
  // scheduled run (the row order is stable), permanently starving the rest
  // of the account's listings of reconciliation -- and every BullMQ retry of
  // the failed scan job re-enqueues duplicate corrective jobs for the rows
  // processed before it. Inventory and price are isolated from each other
  // too, so e.g. a variant with no price still gets its stock reconciled.
  // A failed check is logged and retried naturally on the next scheduled
  // scan; the scan itself still succeeds.
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
        `[reconcile] ${kind} check failed for channel_listing ${row.id} ` +
          `(variant ${row.medusa_variant_id}); skipping it this run:`,
        err
      )
    }
  }

  for (const row of rows) {
    if (row.last_synced_quantity !== null) {
      await runCheck(row, "inventory", async () => {
        const inventory = await medusaClient.getVariantInventory(
          row.medusa_variant_id
        )
        if (inventory.quantity !== row.last_synced_quantity) {
          await inventoryQueue.add("reconcile", { channelListingId: row.id })
          driftFound++
        }
      })
    }

    if (row.last_synced_price !== null) {
      await runCheck(row, "price", async () => {
        const pricing = await medusaClient.getVariantPricing(
          row.medusa_variant_id
        )
        const expectedAmount = applyPriceRule(pricing.amount, row.price_rule)
        if (expectedAmount !== Number(row.last_synced_price)) {
          await priceQueue.add("reconcile", { channelListingId: row.id })
          driftFound++
        }
      })
    }
  }

  return { driftFound, failedChecks }
}

export type ReconcileShopifyDeps = {
  pool: Pool
  medusaClient: MedusaAdminClient
  integrationAccountId: string
  inventoryQueue: Queue
  priceQueue: Queue
  orderQueue: Queue
  fetchOrdersSince: (sinceIso: string) => Promise<{ shopifyOrderId: string }[]>
}

const SHOPIFY_ORDER_GID_PREFIX = "gid://shopify/Order/"
const FIRST_SCAN_LOOKBACK_MS = 24 * 60 * 60 * 1000

/**
 * Shopify counterpart of `reconcile`: requeues stock/price drift (against the
 * post-rule `last_synced_*` baseline, same quantity clamp as
 * `pushShopifyInventory`) and re-enqueues Shopify orders updated since the
 * account's `last_synced_at` (24h back when null) using the webhook's job
 * shape/id so duplicates collapse. It never writes to Medusa or Shopify.
 * A listing with a NULL baseline (never pushed) is enqueued as drift.
 * `last_synced_at` advances (to the scan start) once the order catch-up
 * succeeded, regardless of per-listing check failures.
 */
export const reconcileShopify = async (
  deps: ReconcileShopifyDeps
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
        `[reconcile-shopify] ${kind} check failed for channel_listing ${row.id} ` +
          `(variant ${row.medusa_variant_id}); skipping it this run:`,
        err
      )
    }
  }

  for (const row of rows) {
    // A NULL baseline means the listing was never pushed (freshly linked):
    // StoreCentral is the master, so push it now rather than skip it.
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
        // Same clamp as pushShopifyInventory, so a clamped value is not drift.
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
            `Medusa price for variant ${row.medusa_variant_id} is in ${pricing.currencyCode}; only USD is supported for Shopify`
          )
        }
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
    const orders = await fetchOrdersSince(since.toISOString())
    for (const order of orders) {
      const gid = order.shopifyOrderId
      if (!gid.startsWith(SHOPIFY_ORDER_GID_PREFIX)) {
        throw new Error(`unexpected Shopify order id "${gid}"`)
      }
      const numericId = gid.slice(SHOPIFY_ORDER_GID_PREFIX.length)
      // Same shape and job id as the webhook, so duplicates collapse.
      await orderQueue.add(
        "reconcile",
        { shopifyOrderId: gid },
        {
          jobId: `shopify-order-${numericId}`,
          removeOnComplete: true,
          removeOnFail: true,
        }
      )
      ordersRequeued++
    }
  } catch (err) {
    ordersFetched = false
    console.error("[reconcile-shopify] missed-order catch-up failed:", err)
  }

  // Watermark depends only on the order scan: a permanently bad listing must
  // not freeze it and grow the scan window without bound.
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

/**
 * Schedules `reconcile` to run on a recurring cadence by adding a BullMQ
 * repeatable job to `queue`. The actual `reconcile` call is made by
 * whatever worker consumes `queue`'s `"reconcile"` jobs (wiring that is
 * outside this task's scope) -- this function only owns the schedule
 * itself.
 */
export const scheduleReconciliation = async (
  queue: Queue,
  everyMs: number,
  opts?: { shopify?: boolean }
): Promise<void> => {
  await queue.add("reconcile", {}, { repeat: { every: everyMs } })
  if (opts?.shopify) {
    await queue.add("reconcile-shopify", {}, { repeat: { every: everyMs } })
  }
}
