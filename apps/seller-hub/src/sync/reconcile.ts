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

/**
 * Schedules `reconcile` to run on a recurring cadence by adding a BullMQ
 * repeatable job to `queue`. The actual `reconcile` call is made by
 * whatever worker consumes `queue`'s `"reconcile"` jobs (wiring that is
 * outside this task's scope) -- this function only owns the schedule
 * itself.
 */
export const scheduleReconciliation = async (
  queue: Queue,
  everyMs: number
): Promise<void> => {
  await queue.add("reconcile", {}, { repeat: { every: everyMs } })
}
