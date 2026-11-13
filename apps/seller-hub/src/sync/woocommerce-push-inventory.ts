import type { Pool } from "pg"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import { PermanentSyncError } from "../queue/queues.js"
import {
  markSyncJobFailed,
  markSyncJobSucceeded,
} from "../queue/sync-job-tracking.js"
import type { WooCommerceClient } from "../woocommerce/client.js"
import { setWooStock } from "../woocommerce/products.js"

export type PushWooInventoryDeps = {
  pool: Pool
  medusaClient: MedusaAdminClient
  wooClient: WooCommerceClient
  integrationAccountId: string
  channelListingId: string
}

type ChannelListingRow = {
  medusa_variant_id: string
  external_variant_id: string | null
  external_parent_id: string | null
}

/**
 * Pushes a channel listing's current Medusa available quantity to WooCommerce.
 *
 * Mirrors `push-inventory.ts` (Amazon): tracks the run on
 * `seller_hub.sync_job` keyed by `(integrationAccountId, 'inventory',
 * channelListingId)`; a 4xx-class rejection (other than 429) becomes
 * `PermanentSyncError`, anything else is rethrown unchanged so the worker's
 * retry/backoff applies. The quantity is clamped to a non-negative integer
 * (NaN becomes 0) before it is pushed and recorded.
 */
export const pushWooInventory = async (
  deps: PushWooInventoryDeps
): Promise<void> => {
  const {
    pool,
    medusaClient,
    wooClient,
    integrationAccountId,
    channelListingId,
  } = deps

  const syncJobId = await claimSyncJob(pool, integrationAccountId, channelListingId)
  let pushedQuantity: number | undefined

  try {
    const listing = await fetchChannelListing(
      pool,
      channelListingId,
      integrationAccountId
    )
    if (!listing) {
      throw new PermanentSyncError(
        `channel_listing ${channelListingId} not found for integration account ${integrationAccountId}`
      )
    }
    if (!listing.external_variant_id) {
      throw new PermanentSyncError(
        `channel_listing ${channelListingId} has no WooCommerce id`
      )
    }

    const wooId = parseWooId(listing.external_variant_id, "id", channelListingId)
    const parentId =
      listing.external_parent_id === null
        ? null
        : parseWooId(listing.external_parent_id, "parent id", channelListingId)

    const inventory = await medusaClient.getVariantInventory(
      listing.medusa_variant_id
    )
    pushedQuantity = clampQuantity(inventory.quantity)

    await setWooStock(wooClient, {
      id: wooId,
      parentId,
      quantity: pushedQuantity,
    })

    await markSyncJobSucceeded(pool, syncJobId)
  } catch (err) {
    const toThrow = classifySyncError(err)
    await markSyncJobFailed(pool, syncJobId, toThrow.message)
    throw toThrow
  }

  // Best-effort bookkeeping outside the try/catch: a failure here must not
  // flip a genuinely successful push to "failed" (same as push-inventory.ts).
  try {
    await pool.query(
      `UPDATE seller_hub.channel_listing
       SET last_synced_quantity = $1, updated_at = now()
       WHERE id = $2`,
      [pushedQuantity, channelListingId]
    )
  } catch (err) {
    console.error(
      `[woocommerce-push-inventory] push to WooCommerce succeeded, but failed to record ` +
        `last_synced_quantity for channel_listing ${channelListingId}:`,
      err
    )
  }
}

const clampQuantity = (quantity: number): number =>
  Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : 0

const fetchChannelListing = async (
  pool: Pool,
  channelListingId: string,
  integrationAccountId: string
): Promise<ChannelListingRow | null> => {
  const { rows } = await pool.query<ChannelListingRow>(
    `SELECT medusa_variant_id, external_variant_id, external_parent_id
     FROM seller_hub.channel_listing
     WHERE id = $1 AND integration_account_id = $2`,
    [channelListingId, integrationAccountId]
  )
  return rows[0] ?? null
}

const claimSyncJob = async (
  pool: Pool,
  integrationAccountId: string,
  channelListingId: string
): Promise<string> => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO seller_hub.sync_job
       (integration_account_id, sync_type, external_id, status, attempts)
     VALUES ($1, 'inventory', $2, 'processing', 1)
     ON CONFLICT (integration_account_id, sync_type, external_id)
     DO UPDATE SET status = 'processing', attempts = seller_hub.sync_job.attempts + 1, updated_at = now()
     RETURNING id`,
    [integrationAccountId, channelListingId]
  )
  return rows[0]!.id
}

// Same convention as push-inventory.ts: 4xx except 429 is permanent.
const classifySyncError = (err: unknown): Error => {
  if (err instanceof PermanentSyncError) {
    return err
  }
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
  if (statusKeyword) {
    return Number(statusKeyword[1])
  }
  const leadingCode = message.match(/^(\d{3}):/)
  if (leadingCode) {
    return Number(leadingCode[1])
  }
  return null
}

// WooCommerce ids are stored as strings on channel_listing; the REST paths need integers.
const parseWooId = (value: string, what: string, channelListingId: string): number => {
  const n = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(n)) {
    throw new PermanentSyncError(
      `channel_listing ${channelListingId} has an invalid WooCommerce ${what} "${value}"`
    )
  }
  return n
}
