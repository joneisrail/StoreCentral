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
 * point of view.
 */
export const resolveInventoryChannelListingId = async (
  data: InventorySyncJobData,
  deps: ResolveChannelListingDeps
): Promise<string> => {
  if ("channelListingId" in data) {
    return data.channelListingId
  }

  const variantId = await deps.medusaClient.findVariantIdByInventoryLevelId(
    data.inventoryLevelId
  )
  if (!variantId) {
    throw new PermanentSyncError(
      `No Medusa variant found for inventory level ${data.inventoryLevelId}`
    )
  }

  return resolveChannelListingIdByVariant(
    deps.pool,
    deps.integrationAccountId,
    variantId,
    `inventory level ${data.inventoryLevelId} (variant ${variantId})`
  )
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
 * `channel_listing` mapping for this integration account.
 */
export const resolvePriceChannelListingId = async (
  data: PriceSyncJobData,
  deps: ResolveChannelListingDeps
): Promise<string> => {
  if ("channelListingId" in data) {
    return data.channelListingId
  }

  return resolveChannelListingIdByVariant(
    deps.pool,
    deps.integrationAccountId,
    data.variantId,
    `variant ${data.variantId}`
  )
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
