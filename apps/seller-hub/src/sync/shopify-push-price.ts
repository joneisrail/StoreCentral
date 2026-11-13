import type { Pool } from "pg"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import { PermanentSyncError } from "../queue/queues.js"
import {
  markSyncJobFailed,
  markSyncJobSucceeded,
} from "../queue/sync-job-tracking.js"
import type { ShopifyClient } from "../shopify/client.js"
import { updateShopifyVariantPrice } from "../shopify/products.js"
import { applyPriceRule, type PriceRule } from "./push-price.js"

export type PushShopifyPriceDeps = {
  pool: Pool
  medusaClient: MedusaAdminClient
  shopifyClient: ShopifyClient
  integrationAccountId: string
  channelListingId: string
}

type ChannelListingRow = {
  medusa_variant_id: string
  external_variant_id: string | null
  price_rule: PriceRule | null
}

/**
 * Pushes a channel listing's current Medusa price to Shopify (after the
 * listing's `price_rule`, same as the Amazon push) as a 2-decimal USD string.
 *
 * Shopify prices are sent without a currency, so a non-USD Medusa price is a
 * permanent failure with nothing pushed rather than a silently wrong amount.
 * Tracking and error-wrapping mirror `push-price.ts`.
 */
export const pushShopifyPrice = async (
  deps: PushShopifyPriceDeps
): Promise<void> => {
  const {
    pool,
    medusaClient,
    shopifyClient,
    integrationAccountId,
    channelListingId,
  } = deps

  const syncJobId = await claimSyncJob(pool, integrationAccountId, channelListingId)
  let pushedAmount: number | undefined

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
        `channel_listing ${channelListingId} has no Shopify variant id`
      )
    }

    const pricing = await medusaClient.getVariantPricing(
      listing.medusa_variant_id
    )
    if (pricing.currencyCode.toLowerCase() !== "usd") {
      throw new PermanentSyncError(
        `Medusa price for variant ${listing.medusa_variant_id} is in ${pricing.currencyCode}; only USD is supported for Shopify`
      )
    }
    const amount = applyPriceRule(pricing.amount, listing.price_rule)
    if (!Number.isFinite(amount) || amount < 0) {
      throw new PermanentSyncError(
        `Invalid price ${amount} computed for channel_listing ${channelListingId}`
      )
    }
    pushedAmount = amount

    await updateShopifyVariantPrice(shopifyClient, {
      variantId: listing.external_variant_id,
      price: amount.toFixed(2),
    })

    await markSyncJobSucceeded(pool, syncJobId)
  } catch (err) {
    const toThrow = classifySyncError(err)
    await markSyncJobFailed(pool, syncJobId, toThrow.message)
    throw toThrow
  }

  // Best-effort bookkeeping outside the try/catch (same as push-price.ts).
  try {
    await pool.query(
      `UPDATE seller_hub.channel_listing
       SET last_synced_price = $1, updated_at = now()
       WHERE id = $2`,
      [pushedAmount, channelListingId]
    )
  } catch (err) {
    console.error(
      `[shopify-push-price] push to Shopify succeeded, but failed to record ` +
        `last_synced_price for channel_listing ${channelListingId}:`,
      err
    )
  }
}

const fetchChannelListing = async (
  pool: Pool,
  channelListingId: string,
  integrationAccountId: string
): Promise<ChannelListingRow | null> => {
  const { rows } = await pool.query<ChannelListingRow>(
    `SELECT medusa_variant_id, external_variant_id, price_rule
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
     VALUES ($1, 'price', $2, 'processing', 1)
     ON CONFLICT (integration_account_id, sync_type, external_id)
     DO UPDATE SET status = 'processing', attempts = seller_hub.sync_job.attempts + 1, updated_at = now()
     RETURNING id`,
    [integrationAccountId, channelListingId]
  )
  return rows[0]!.id
}

// Same convention as push-price.ts: 4xx except 429 is permanent.
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
