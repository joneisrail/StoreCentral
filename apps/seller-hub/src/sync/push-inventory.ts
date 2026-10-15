import type { Pool } from "pg"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import { PermanentSyncError } from "../queue/queues.js"
import {
  markSyncJobFailed,
  markSyncJobSucceeded,
} from "../queue/sync-job-tracking.js"
import type { SpApiClient } from "../sp-api/client.js"
import { submitListingFeed } from "../sp-api/listings.js"

export type PushInventoryUpdateDeps = {
  pool: Pool
  medusaClient: MedusaAdminClient
  spApiClient: SpApiClient
  integrationAccountId: string
  channelListingId: string
}

type ChannelListingRow = {
  medusa_variant_id: string
  external_sku: string
  external_asin: string | null
}

/**
 * Pushes a channel listing's current Medusa stock quantity to Amazon.
 *
 * SP-API has no inventory-only submission endpoint — stock is part of the
 * same Listings feed as product attributes (see `sp-api/listings.ts`), so
 * this reads the Medusa variant's current quantity and submits it via
 * `submitListingFeed`. Records the outcome on `seller_hub.sync_job`, keyed
 * by `(integrationAccountId, 'inventory', channelListingId)` — see
 * `push-price.ts`'s `claimSyncJob` doc comment for why `channelListingId`
 * (not an Amazon-issued id) is used as the job's `external_id`.
 *
 * Error-wrapping convention (shared with `push-price.ts`/`push-product.ts`):
 * a 4xx-class rejection becomes `PermanentSyncError` (no retry); anything
 * else is re-thrown unchanged (normal retry/backoff applies).
 */
export const pushInventoryUpdate = async (
  deps: PushInventoryUpdateDeps
): Promise<void> => {
  const {
    pool,
    medusaClient,
    spApiClient,
    integrationAccountId,
    channelListingId,
  } = deps

  const syncJobId = await claimSyncJob(pool, integrationAccountId, channelListingId)

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

    const inventory = await medusaClient.getVariantInventory(
      listing.medusa_variant_id
    )

    await submitListingFeed(spApiClient, {
      sku: listing.external_sku,
      asin: listing.external_asin ?? undefined,
      attributes: { quantity: inventory.quantity },
    })

    await markSyncJobSucceeded(pool, syncJobId)
  } catch (err) {
    const toThrow = classifySyncError(err)
    await markSyncJobFailed(pool, syncJobId, toThrow.message)
    throw toThrow
  }
}

const fetchChannelListing = async (
  pool: Pool,
  channelListingId: string,
  integrationAccountId: string
): Promise<ChannelListingRow | null> => {
  const { rows } = await pool.query<ChannelListingRow>(
    `SELECT medusa_variant_id, external_sku, external_asin
     FROM seller_hub.channel_listing
     WHERE id = $1 AND integration_account_id = $2`,
    [channelListingId, integrationAccountId]
  )
  return rows[0] ?? null
}

// See `push-price.ts`'s `claimSyncJob` for the full rationale (identical
// upsert pattern, duplicated per sync type rather than shared, to keep each
// push-*.ts file self-contained per this task's file-per-responsibility
// layout).
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

// See `push-price.ts`'s `classifySyncError`/`extractHttpStatus` for the
// full rationale — identical convention, duplicated per file on purpose.
const classifySyncError = (err: unknown): Error => {
  if (err instanceof PermanentSyncError) {
    return err
  }
  if (err instanceof Error) {
    const status = extractHttpStatus(err.message)
    if (status !== null && status >= 400 && status <= 499) {
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
