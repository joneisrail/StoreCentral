import type { Pool } from "pg"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import { PermanentSyncError } from "../queue/queues.js"
import {
  markSyncJobFailed,
  markSyncJobSucceeded,
} from "../queue/sync-job-tracking.js"
import type { SpApiClient } from "../sp-api/client.js"
import { getFeedResult, submitListingFeed } from "../sp-api/listings.js"
import type { FeedResult } from "../sp-api/listings.js"

export type PushProductListingDeps = {
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

const POLL_MAX_ATTEMPTS = 5
// Test-friendly, not modeling Amazon's real feed-processing latency (which
// can take minutes) — this task mocks `SpApiClient` entirely, and the exact
// polling cadence isn't specified by the brief. A real deployment would
// want this (and `POLL_MAX_ATTEMPTS`) tuned, or polling moved to a separate
// scheduled check rather than a tight in-process loop.
const POLL_INTERVAL_MS = 25

/**
 * Pushes a channel listing's product data to Amazon end to end: moves
 * `channel_listing.status` `draft -> pending`, submits the listing via
 * `submitListingFeed` (sku/asin + current Medusa price/inventory as the
 * feed's attributes), polls `getFeedResult` until the feed leaves
 * `IN_PROGRESS`, then lands the listing on `published` (feed `DONE`) or
 * `rejected` (feed `CANCELLED`/`FATAL`, with `channel_listing.last_error`
 * set from the feed's `errors`).
 *
 * Status-progression/error-wrapping notes:
 * - The `draft -> pending` move happens *before* `submitListingFeed` is
 *   called, so a listing's status in Postgres always reflects whether
 *   Amazon has been asked about it yet.
 * - A terminal bad feed outcome (`CANCELLED`/`FATAL`) is a confirmed,
 *   Amazon-verified rejection — it moves the listing to `rejected` and
 *   throws `PermanentSyncError` (no retry; resubmitting the same listing
 *   data would fail identically).
 * - Any other failure (a transient SP-API/Medusa error, e.g. a 5xx or a
 *   network error) is *not* a confirmed rejection — the listing is left at
 *   `pending` (not forced to `rejected`) and the original error is
 *   re-thrown unchanged, so Task 7's worker retries the whole push later.
 */
export const pushProductListing = async (
  deps: PushProductListingDeps
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

    await setChannelListingStatus(pool, channelListingId, "pending")

    const [pricing, inventory] = await Promise.all([
      medusaClient.getVariantPricing(listing.medusa_variant_id),
      medusaClient.getVariantInventory(listing.medusa_variant_id),
    ])

    const { feedId } = await submitListingFeed(spApiClient, {
      sku: listing.external_sku,
      asin: listing.external_asin ?? undefined,
      attributes: {
        price: pricing.amount,
        currencyCode: pricing.currencyCode,
        quantity: inventory.quantity,
      },
    })

    const result = await pollFeedResult(spApiClient, feedId)

    if (result.status === "DONE") {
      await setChannelListingStatus(pool, channelListingId, "published")
      await markSyncJobSucceeded(pool, syncJobId)
      return
    }

    // CANCELLED | FATAL: a confirmed, terminal rejection from Amazon.
    const errorMessage =
      result.errors?.join("; ") ??
      `Feed ${feedId} ended with status ${result.status}`
    await setChannelListingStatus(pool, channelListingId, "rejected", errorMessage)
    await markSyncJobFailed(pool, syncJobId, errorMessage)
    throw new PermanentSyncError(errorMessage)
  } catch (err) {
    if (err instanceof PermanentSyncError) {
      // Already recorded on both channel_listing and sync_job above (the
      // "not found" branch and the CANCELLED/FATAL branch both do so before
      // throwing) — just propagate.
      throw err
    }

    const toThrow = classifySyncError(err)
    await markSyncJobFailed(pool, syncJobId, toThrow.message)
    // Deliberately does NOT move channel_listing to 'rejected' here: this
    // is a transient SP-API/Medusa failure (or a non-4xx error), not a
    // confirmed bad feed outcome, so the listing is left at whatever status
    // it already reached ('pending', if the submission itself is what
    // failed) for the worker's retry to pick back up.
    throw toThrow
  }
}

const pollFeedResult = async (
  client: SpApiClient,
  feedId: string
): Promise<FeedResult> => {
  for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
    const result = await getFeedResult(client, feedId)
    if (result.status !== "IN_PROGRESS") {
      return result
    }
    if (attempt < POLL_MAX_ATTEMPTS) {
      await wait(POLL_INTERVAL_MS)
    }
  }
  // Still IN_PROGRESS after exhausting polls — Amazon simply hasn't
  // finished processing yet, not a confirmed bad outcome. Treat as
  // transient so the worker's retry/backoff (Task 7) checks again later,
  // rather than permanently rejecting a feed that may still succeed.
  throw new Error(
    `Feed ${feedId} still IN_PROGRESS after ${POLL_MAX_ATTEMPTS} polls`
  )
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

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

const setChannelListingStatus = async (
  pool: Pool,
  channelListingId: string,
  status: "pending" | "published" | "rejected",
  lastError: string | null = null
): Promise<void> => {
  await pool.query(
    `UPDATE seller_hub.channel_listing
     SET status = $1, last_error = $2, updated_at = now()
     WHERE id = $3`,
    [status, lastError, channelListingId]
  )
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
     VALUES ($1, 'product', $2, 'processing', 1)
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
