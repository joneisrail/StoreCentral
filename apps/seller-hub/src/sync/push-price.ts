import type { Pool } from "pg"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import { PermanentSyncError } from "../queue/queues.js"
import {
  markSyncJobFailed,
  markSyncJobSucceeded,
} from "../queue/sync-job-tracking.js"
import type { SpApiClient } from "../sp-api/client.js"
import { submitPriceUpdate } from "../sp-api/pricing.js"

export type PushPriceUpdateDeps = {
  pool: Pool
  medusaClient: MedusaAdminClient
  spApiClient: SpApiClient
  integrationAccountId: string
  channelListingId: string
}

export type PriceRule = {
  type: "percentage" | "fixed"
  value: number
}

type ChannelListingRow = {
  medusa_variant_id: string
  external_sku: string
  price_rule: PriceRule | null
}

/**
 * Pushes a channel listing's current Medusa price to Amazon, after applying
 * the listing's `price_rule` (a percentage markup over Medusa's price, or a
 * fixed override price — see `applyPriceRule`).
 *
 * Reads current Medusa state, submits the computed amount via
 * `submitPriceUpdate`, and records the outcome on `seller_hub.sync_job`
 * (keyed by `(integrationAccountId, 'price', channelListingId)` — the
 * `channelListingId`, not an externally-issued id, since there's no
 * Amazon-side identifier for a price push before it's submitted). On
 * failure: a 4xx-class rejection (Amazon or Medusa) is re-thrown as
 * `PermanentSyncError` so Task 7's worker doesn't retry a request that will
 * fail identically every time; anything else is re-thrown unchanged so the
 * worker's normal retry/backoff applies.
 */
export const pushPriceUpdate = async (
  deps: PushPriceUpdateDeps
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

    const pricing = await medusaClient.getVariantPricing(
      listing.medusa_variant_id
    )
    const amount = applyPriceRule(pricing.amount, listing.price_rule)

    await submitPriceUpdate(spApiClient, {
      sku: listing.external_sku,
      amount,
      currencyCode: pricing.currencyCode,
    })

    await markSyncJobSucceeded(pool, syncJobId)
  } catch (err) {
    const toThrow = classifySyncError(err)
    await markSyncJobFailed(pool, syncJobId, toThrow.message)
    throw toThrow
  }
}

/**
 * Applies a `channel_listing.price_rule` to a base Medusa price:
 * - `"percentage"`: a markup over the base price, e.g.
 *   `{ type: "percentage", value: 10 }` on a $29.99 base price submits
 *   $32.99 (`29.99 * 1.10`, per the spec's example).
 * - `"fixed"`: an absolute override price — the rule's `value` is submitted
 *   as-is, ignoring the Medusa price entirely. (The schema's own comment
 *   only illustrates the `"percentage"` shape; `"fixed"` as "set this exact
 *   price on Amazon regardless of what Medusa says" is this percentage
 *   rule's natural complement and the only sensible reading of a
 *   non-percentage price rule.)
 * - no rule (`null`): the Medusa price is submitted unchanged.
 *
 * Always rounds to 2 decimal places (currency minor units), since floating
 * point multiplication (e.g. `29.99 * 1.10`) can otherwise land a cent off.
 */
export const applyPriceRule = (
  baseAmount: number,
  rule: PriceRule | null
): number => {
  if (!rule) {
    return round2(baseAmount)
  }
  if (rule.type === "fixed") {
    return round2(rule.value)
  }
  return round2(baseAmount * (1 + rule.value / 100))
}

const round2 = (value: number): number => Math.round(value * 100) / 100

const fetchChannelListing = async (
  pool: Pool,
  channelListingId: string,
  integrationAccountId: string
): Promise<ChannelListingRow | null> => {
  const { rows } = await pool.query<ChannelListingRow>(
    `SELECT medusa_variant_id, external_sku, price_rule
     FROM seller_hub.channel_listing
     WHERE id = $1 AND integration_account_id = $2`,
    [channelListingId, integrationAccountId]
  )
  return rows[0] ?? null
}

/**
 * Upserts the `seller_hub.sync_job` row this push run is tracked against,
 * claiming it as `processing` before any Medusa/SP-API call is made. Keyed
 * by `(integration_account_id, sync_type, external_id=channelListingId)` —
 * the same `UNIQUE` constraint Task 6's `import-order.ts` relies on, here
 * used as an upsert (rather than an insert-or-claim state machine) since,
 * unlike order import, a push's own idempotency isn't the concern here —
 * Task 7's queue layer already guarantees at-most-one in-flight attempt per
 * BullMQ job, and a push is naturally safe to redo (it just re-reads
 * current Medusa state and re-submits).
 */
const claimSyncJob = async (
  pool: Pool,
  integrationAccountId: string,
  channelListingId: string
): Promise<string> => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO seller_hub.sync_job
       (integration_account_id, sync_type, external_id, status, attempts)
     VALUES ($1, 'price', $2, 'processing', 1)
     ON CONFLICT (integration_account_id, sync_type, external_id)
     DO UPDATE SET status = 'processing', attempts = seller_hub.sync_job.attempts + 1, updated_at = now()
     RETURNING id`,
    [integrationAccountId, channelListingId]
  )
  return rows[0]!.id
}

/**
 * Classifies a caught error per this task's retry convention (shared,
 * identically, by `push-inventory.ts` and `push-product.ts`):
 * - A 4xx-class HTTP failure *other than 429* (from the SP-API client's or
 *   Medusa admin client's own error message, both of which embed the status
 *   code — see `sp-api/client.ts`'s
 *   `SP-API request "..." failed with status ${status}` and
 *   `medusa/admin-client.ts`'s equivalent — or the brief's own simpler
 *   `"400: ..."`-shaped test fixture) is wrapped as `PermanentSyncError`,
 *   since retrying an identical request that Amazon/Medusa already
 *   rejected as invalid cannot succeed.
 * - 429 (rate limit) and 5xx are transient per the plan's Global
 *   Constraint ("transient errors (429, 5xx) retry with exponential
 *   backoff + jitter, capped attempts; permanent errors (4xx validation)
 *   fail immediately") even though 429 is numerically a 4xx — it means
 *   "you were throttled," not "this request is invalid." `sp-api/client.ts`
 *   itself already retries 429/5xx up to its own `MAX_ATTEMPTS`; once that
 *   is exhausted, re-throwing as-is here lets Task 7's BullMQ-level
 *   retry/backoff keep trying later instead of killing the job permanently.
 * - Anything else (a `PermanentSyncError` thrown earlier in this same
 *   function, e.g. for a missing `channel_listing` row, is passed through
 *   unchanged; everything else is assumed transient) is re-thrown as-is, so
 *   Task 7's worker applies its normal attempts/backoff retry.
 */
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
