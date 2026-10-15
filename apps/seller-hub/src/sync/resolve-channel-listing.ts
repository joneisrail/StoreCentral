import type { Pool } from "pg"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import { PermanentSyncError } from "../queue/queues.js"

export type ResolveChannelListingDeps = {
  pool: Pool
  medusaClient: MedusaAdminClient
  integrationAccountId: string
}

/**
 * The two shapes a BullMQ `inventory-sync` job can arrive in (see
 * `apps/seller-hub/src/index.ts`'s bootstrap wiring):
 * - `{ inventoryLevelId }`: produced by the webhook flow (Task 9's
 *   `webhook/server.ts`), forwarding a real-time Medusa inventory change.
 * - `{ channelListingId }`: produced by reconciliation (Task 11's
 *   `reconcile`), which already knows the drifted listing's own id.
 */
export type InventorySyncJobData =
  | { channelListingId: string }
  | { inventoryLevelId: string }

/**
 * The two shapes a BullMQ `price-sync` job can arrive in -- the price
 * equivalent of `InventorySyncJobData` above:
 * - `{ variantId }`: produced by the webhook flow.
 * - `{ channelListingId }`: produced by reconciliation.
 */
export type PriceSyncJobData =
  | { channelListingId: string }
  | { variantId: string }

/**
 * Resolves an `inventory-sync` job's data to the `channelListingId`
 * `pushInventoryUpdate` (Task 8) requires, regardless of which of the two
 * shapes above it arrived in.
 *
 * `{ inventoryLevelId }` has no direct DB mapping to a `channel_listing` row
 * -- `seller_hub.channel_listing` only stores `medusa_variant_id`, not any
 * inventory-item/level id (see `db/schema.ts`) -- so it's resolved in two
 * hops: `MedusaAdminClient#findVariantIdByInventoryLevelId` turns the
 * inventory level id into a Medusa variant id via the Admin API, then that
 * variant id is looked up against `channel_listing` exactly like
 * `{ variantId }` would be.
 *
 * Throws `PermanentSyncError` (no BullMQ retry) if either hop comes up
 * empty: retrying an unmapped inventory level or variant with the exact same
 * input can't succeed until something changes on the Medusa/`channel_listing`
 * side, which looks identical to "will never succeed" from the worker's
 * point of view. Either way (and for any other error either hop raises),
 * the failure is recorded on `seller_hub.sync_job` (sync_type `'inventory'`,
 * `external_id` = the raw `inventoryLevelId` -- there's no `channelListingId`
 * yet at this point, so it can't be keyed the same way `pushInventoryUpdate`'s
 * own tracking row is) before being rethrown, so an unmapped listing -- the
 * expected steady state for any product that exists in Medusa before it's
 * been listed on Amazon -- is visible in the same place every other failure
 * in this codebase is, instead of only existing in BullMQ's own job state.
 */
export const resolveInventoryChannelListingId = async (
  data: InventorySyncJobData,
  deps: ResolveChannelListingDeps
): Promise<string> => {
  if ("channelListingId" in data) {
    return data.channelListingId
  }

  try {
    const variantId = await deps.medusaClient.findVariantIdByInventoryLevelId(
      data.inventoryLevelId
    )
    if (!variantId) {
      throw new PermanentSyncError(
        `No Medusa variant found for inventory level ${data.inventoryLevelId}`
      )
    }

    return await resolveChannelListingIdByVariant(
      deps.pool,
      deps.integrationAccountId,
      variantId,
      `inventory level ${data.inventoryLevelId} (variant ${variantId})`
    )
  } catch (err) {
    await recordResolutionFailure(
      deps.pool,
      deps.integrationAccountId,
      "inventory",
      data.inventoryLevelId,
      errorMessage(err)
    )
    throw err
  }
}

/**
 * Resolves a `price-sync` job's data to the `channelListingId`
 * `pushPriceUpdate` (Task 8) requires, regardless of which of the two shapes
 * above it arrived in. `{ variantId }` resolves directly against
 * `channel_listing.medusa_variant_id` -- no Medusa Admin API call needed,
 * since a variant id (unlike an inventory level id) is exactly what that
 * column stores.
 *
 * Throws `PermanentSyncError` (no BullMQ retry) if the variant has no
 * `channel_listing` mapping for this integration account -- recorded on
 * `seller_hub.sync_job` (sync_type `'price'`, `external_id` = the raw
 * `variantId`) first, for the same reason `resolveInventoryChannelListingId`
 * records its own failures: this is the expected steady state for any
 * not-yet-listed product, and should be visible there like every other
 * failure in this codebase.
 */
export const resolvePriceChannelListingId = async (
  data: PriceSyncJobData,
  deps: ResolveChannelListingDeps
): Promise<string> => {
  if ("channelListingId" in data) {
    return data.channelListingId
  }

  try {
    return await resolveChannelListingIdByVariant(
      deps.pool,
      deps.integrationAccountId,
      data.variantId,
      `variant ${data.variantId}`
    )
  } catch (err) {
    await recordResolutionFailure(
      deps.pool,
      deps.integrationAccountId,
      "price",
      data.variantId,
      errorMessage(err)
    )
    throw err
  }
}

const resolveChannelListingIdByVariant = async (
  pool: Pool,
  integrationAccountId: string,
  variantId: string,
  describedAs: string
): Promise<string> => {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM seller_hub.channel_listing
     WHERE integration_account_id = $1 AND medusa_variant_id = $2`,
    [integrationAccountId, variantId]
  )
  const row = rows[0]
  if (!row) {
    throw new PermanentSyncError(
      `No channel_listing mapping found for ${describedAs}`
    )
  }
  return row.id
}

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

/**
 * Claims-and-fails a `seller_hub.sync_job` row for a resolution failure, in
 * one upsert (unlike `push-*.ts`'s claim-as-'processing'-then-mark-failed
 * two-step, since resolution has no meaningful intermediate "processing"
 * state worth recording -- it either resolves or it doesn't, synchronously
 * from the caller's perspective). Keyed by `(integration_account_id,
 * sync_type, external_id)`, same as every other `sync_job` row, but with
 * `external_id` set to the raw `inventoryLevelId`/`variantId` rather than a
 * `channelListingId` -- distinct from (and never colliding with) the row
 * `pushInventoryUpdate`/`pushPriceUpdate` themselves claim once resolution
 * succeeds, since those are keyed by `channelListingId` instead.
 */
const recordResolutionFailure = async (
  pool: Pool,
  integrationAccountId: string,
  syncType: "inventory" | "price",
  externalId: string,
  error: string
): Promise<void> => {
  await pool.query(
    `INSERT INTO seller_hub.sync_job
       (integration_account_id, sync_type, external_id, status, attempts, last_error)
     VALUES ($1, $2, $3, 'failed', 1, $4)
     ON CONFLICT (integration_account_id, sync_type, external_id)
     DO UPDATE SET status = 'failed', last_error = $4, attempts = seller_hub.sync_job.attempts + 1, updated_at = now()`,
    [integrationAccountId, syncType, externalId, error]
  )
}
