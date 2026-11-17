import type { Pool } from "pg"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import { PermanentSyncError } from "../queue/queues.js"
import {
  markSyncJobFailed,
  markSyncJobSucceeded,
} from "../queue/sync-job-tracking.js"
import type { ChannelPushJobData } from "./channel-push-enqueue.js"
import { applyPriceRule, type PriceRule } from "./push-price.js"

export type ChannelPushListing = {
  id: string
  medusa_variant_id: string
  external_sku: string
  external_variant_id: string | null
  external_inventory_item_id: string | null
  external_parent_id: string | null
  price_rule: PriceRule | null
}

export type ChannelPushDeps = {
  pool: Pool
  medusaClient: MedusaAdminClient
  integrationAccountId: string
  /** Pushes an absolute stock number (already a non-negative integer). */
  pushStock: (listing: ChannelPushListing, stock: number) => Promise<void>
  /** Pushes a price (after the connection's price_rule). */
  pushPrice: (listing: ChannelPushListing, price: number) => Promise<void>
  /** Defaults to the channel_listing row of this account for the variant. */
  findListing?: (variantId: string) => Promise<ChannelPushListing | null>
  /** True on the job's last BullMQ attempt: a transient failure is then reported failed. */
  finalAttempt?: boolean
}

export const findChannelListing = async (
  pool: Pool,
  integrationAccountId: string,
  variantId: string
): Promise<ChannelPushListing | null> => {
  const { rows } = await pool.query<ChannelPushListing>(
    `SELECT id, medusa_variant_id, external_sku, external_variant_id,
            external_inventory_item_id, external_parent_id, price_rule
     FROM seller_hub.channel_listing
     WHERE integration_account_id = $1 AND medusa_variant_id = $2`,
    [integrationAccountId, variantId]
  )
  return rows[0] ?? null
}

const clampQuantity = (quantity: number): number =>
  Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : 0

/**
 * Pushes one channel's own stock and/or price (read from the backend's
 * push-values route, not the variant total) to the connection's marketplace,
 * then reports the outcome back. A permanent failure is reported `failed` and
 * swallowed (no retry); a transient one is recorded and rethrown for BullMQ
 * back-off without ever being reported as synced.
 */
export const processChannelPushJob = async (
  job: ChannelPushJobData,
  deps: ChannelPushDeps
): Promise<void> => {
  const { pool, medusaClient, integrationAccountId } = deps
  const { variantId, salesChannelId, kind } = job

  const report = async (
    result: Parameters<MedusaAdminClient["reportChannelSyncResult"]>[2]
  ): Promise<void> => {
    try {
      await medusaClient.reportChannelSyncResult(variantId, salesChannelId, result)
    } catch (err) {
      // The marketplace push already happened; a lost report must not fail the job.
      console.error(
        `[channel-push] failed to report sync result (${err instanceof Error ? err.constructor.name : typeof err})`
      )
    }
  }

  const listing = await (deps.findListing
    ? deps.findListing(variantId)
    : findChannelListing(pool, integrationAccountId, variantId))
  if (!listing) {
    await report({ state: "failed", error: "not listed" })
    return
  }

  let activeSyncJobId: string | null = null
  const pushed: { stock?: number; price?: number } = {}
  try {
    const values = await medusaClient.getChannelPushValues(variantId, salesChannelId)

    if (kind === "stock" || kind === "both") {
      const stock = clampQuantity(values.stock)
      activeSyncJobId = await claimSyncJob(pool, integrationAccountId, "inventory", listing.id)
      await deps.pushStock(listing, stock)
      await markSyncJobSucceeded(pool, activeSyncJobId)
      activeSyncJobId = null
      pushed.stock = stock
      await recordLastSynced(pool, listing.id, "last_synced_quantity", stock)
    }

    if (kind === "price" || kind === "both") {
      const price = applyPriceRule(values.effective_price, listing.price_rule)
      activeSyncJobId = await claimSyncJob(pool, integrationAccountId, "price", listing.id)
      if (!Number.isFinite(price) || price < 0) {
        throw new PermanentSyncError(`Invalid price computed for variant ${variantId}`)
      }
      await deps.pushPrice(listing, price)
      await markSyncJobSucceeded(pool, activeSyncJobId)
      activeSyncJobId = null
      pushed.price = price
      await recordLastSynced(pool, listing.id, "last_synced_price", price)
    }
  } catch (err) {
    const toThrow = classifySyncError(err)
    if (activeSyncJobId) {
      await markSyncJobFailed(pool, activeSyncJobId, toThrow.message)
    }
    if (toThrow instanceof PermanentSyncError) {
      console.error(`[channel-push] permanent failure for channel ${salesChannelId}`)
      await report({ state: "failed", error: toThrow.message })
      return
    }
    if (deps.finalAttempt) {
      await report({
        state: "failed",
        error: "Marketplace unreachable; will retry on next change",
      })
    }
    throw toThrow
  }

  await report({ state: "synced", ...pushed })
}

const claimSyncJob = async (
  pool: Pool,
  integrationAccountId: string,
  syncType: "inventory" | "price",
  channelListingId: string
): Promise<string> => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO seller_hub.sync_job
       (integration_account_id, sync_type, external_id, status, attempts)
     VALUES ($1, '${syncType}', $2, 'processing', 1)
     ON CONFLICT (integration_account_id, sync_type, external_id)
     DO UPDATE SET status = 'processing', attempts = seller_hub.sync_job.attempts + 1, updated_at = now()
     RETURNING id`,
    [integrationAccountId, channelListingId]
  )
  return rows[0]!.id
}

// Best-effort bookkeeping: must not flip a successful push to failed.
const recordLastSynced = async (
  pool: Pool,
  channelListingId: string,
  column: "last_synced_quantity" | "last_synced_price",
  value: number
): Promise<void> => {
  try {
    await pool.query(
      `UPDATE seller_hub.channel_listing SET ${column} = $1, updated_at = now() WHERE id = $2`,
      [value, channelListingId]
    )
  } catch (err) {
    console.error(
      `[channel-push] push succeeded, but failed to record ${column} for channel_listing ${channelListingId} (${err instanceof Error ? err.constructor.name : typeof err})`
    )
  }
}

// Same convention as the other push flows: 4xx except 429 is permanent.
const classifySyncError = (err: unknown): Error => {
  if (err instanceof PermanentSyncError) return err
  if (err instanceof Error) {
    const status = extractHttpStatus(err.message)
    if (status !== null && status >= 400 && status <= 499 && status !== 429) {
      return new PermanentSyncError(err.message)
    }
    return err
  }
  return new Error(String(err))
}

const extractHttpStatus = (message: string): number | null => {
  const statusKeyword = message.match(/status\s+(\d{3})\b/i)
  if (statusKeyword) return Number(statusKeyword[1])
  const leadingCode = message.match(/^(\d{3}):/)
  if (leadingCode) return Number(leadingCode[1])
  return null
}
