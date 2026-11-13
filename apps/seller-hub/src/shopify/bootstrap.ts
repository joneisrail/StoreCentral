import type { Redis as IORedis } from "ioredis"
import type { Pool } from "pg"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import { createSyncQueue, createSyncWorker } from "../queue/queues.js"
import {
  reconcileShopify,
} from "../sync/reconcile.js"
import {
  resolveInventoryChannelListingId,
  resolvePriceChannelListingId,
  type InventorySyncJobData,
  type PriceSyncJobData,
} from "../sync/resolve-channel-listing.js"
import { linkShopifyVariants, type LinkResult } from "../sync/shopify-link.js"
import {
  processShopifyOrderSyncJob,
  type ShopifyOrderSyncJobData,
} from "../sync/shopify-order-sync-processor.js"
import { pushShopifyInventory } from "../sync/shopify-push-inventory.js"
import { pushShopifyPrice } from "../sync/shopify-push-price.js"
import type { ShopifyWebhookDeps } from "../webhook/server.js"
import { resolveShopifyAccount } from "./account.js"
import { ShopifyClient } from "./client.js"
import type { ShopifyConfig } from "./config.js"
import { fetchShopifyOrder, fetchShopifyOrdersSince } from "./orders.js"

/** Name of the repeatable job that triggers the Shopify drift/order scan. */
export const RECONCILE_SHOPIFY_JOB = "reconcile-shopify"

export type StartShopifyDeps = {
  config: ShopifyConfig
  pool: Pool
  medusaClient: MedusaAdminClient
  encryptionKey: string
  redisConnection: IORedis
  reconcileIntervalMs: number
  /** Tests inject fakes for everything below; production uses the defaults. */
  createQueue?: typeof createSyncQueue
  createWorker?: typeof createSyncWorker
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

export type ShopifyRuntime = {
  /** Pass to `createWebhookServer({ shopify })`. */
  webhook: ShopifyWebhookDeps
  /** Settles when the boot-time SKU link finishes (null if it failed). */
  linked: Promise<LinkResult | null>
}

type JobLike<T> = { name: string; data: T }

/**
 * Starts the Shopify side of the service: resolves the Shopify account,
 * builds the client, kicks off the one-off SKU link (log-only on failure, not
 * awaited so a slow Shopify never delays the webhook server), creates the
 * three `shopify-*` queues and their workers, and schedules the reconcile.
 *
 * The reconcile is a repeatable job on the SHOPIFY inventory queue (never the
 * Amazon one), routed by job name in that queue's worker; every other job on
 * it is a push job.
 */
export const startShopify = async (
  deps: StartShopifyDeps
): Promise<ShopifyRuntime> => {
  const {
    config,
    pool,
    medusaClient,
    encryptionKey,
    redisConnection,
    reconcileIntervalMs,
  } = deps
  const createQueue = deps.createQueue ?? createSyncQueue
  const createWorker = deps.createWorker ?? createSyncWorker

  const account = await resolveShopifyAccount(pool, config, encryptionKey)
  console.log(`[seller-hub] using Shopify integration_account ${account.id}`)

  const shopifyClient = new ShopifyClient({
    shopDomain: config.shopDomain,
    accessToken: config.accessToken,
    fetchImpl: deps.fetchImpl,
    sleep: deps.sleep,
  })
  const integrationAccountId = account.id

  const linked = linkShopifyVariants({
    pool,
    medusaClient,
    shopifyClient,
    integrationAccountId,
  }).then(
    (result) => {
      console.log(
        `[seller-hub] Shopify SKU link: ${result.linked} linked, ` +
          `${result.alreadyLinked} already linked, ${result.unmatched.length} ` +
          `unmatched, ${result.duplicates.length} duplicate`
      )
      return result
    },
    (err) => {
      console.error("[seller-hub] Shopify SKU link failed:", err)
      return null
    }
  )

  const orderQueue = createQueue("shopify-order-sync", redisConnection)
  const inventoryQueue = createQueue("shopify-inventory-sync", redisConnection)
  const priceQueue = createQueue("shopify-price-sync", redisConnection)

  let cachedSalesChannelId: string | null = null

  // No job-name routing here: every job on this queue is an order import.
  createWorker<ShopifyOrderSyncJobData>(
    "shopify-order-sync",
    redisConnection,
    async (job: JobLike<ShopifyOrderSyncJobData>) => {
      const result = await processShopifyOrderSyncJob(job.data, {
        pool,
        medusaClient,
        integrationAccountId,
        resolveSalesChannelId: async () => {
          if (!cachedSalesChannelId) {
            cachedSalesChannelId =
              await medusaClient.findSalesChannelIdByName("Shopify")
          }
          return cachedSalesChannelId
        },
        fetchOrder: (shopifyOrderId) =>
          fetchShopifyOrder(shopifyClient, shopifyOrderId),
      })
      console.log(
        `[seller-hub] shopify-order-sync ${job.data.shopifyOrderId}: ${result.status}` +
          (result.medusaOrderId ? ` (${result.medusaOrderId})` : "")
      )
    }
  )

  createWorker<InventorySyncJobData | Record<string, never>>(
    "shopify-inventory-sync",
    redisConnection,
    async (job: JobLike<InventorySyncJobData | Record<string, never>>) => {
      if (job.name === RECONCILE_SHOPIFY_JOB) {
        const result = await reconcileShopify({
          pool,
          medusaClient,
          integrationAccountId,
          inventoryQueue,
          priceQueue,
          orderQueue,
          fetchOrdersSince: (sinceIso) =>
            fetchShopifyOrdersSince(shopifyClient, sinceIso),
        })
        console.log(
          `[seller-hub] reconcile-shopify: ${JSON.stringify(result)}`
        )
        return
      }
      const channelListingId = await resolveInventoryChannelListingId(
        job.data as InventorySyncJobData,
        { pool, medusaClient, integrationAccountId }
      )
      await pushShopifyInventory({
        pool,
        medusaClient,
        shopifyClient,
        integrationAccountId,
        locationId: account.locationId,
        channelListingId,
      })
    }
  )

  createWorker<PriceSyncJobData>(
    "shopify-price-sync",
    redisConnection,
    async (job: JobLike<PriceSyncJobData>) => {
      const channelListingId = await resolvePriceChannelListingId(job.data, {
        pool,
        medusaClient,
        integrationAccountId,
      })
      await pushShopifyPrice({
        pool,
        medusaClient,
        shopifyClient,
        integrationAccountId,
        channelListingId,
      })
    }
  )
  console.log("[seller-hub] Shopify queues and workers started")

  // Added directly (not via scheduleReconciliation's `shopify` option, which
  // also adds the Amazon "reconcile" job): this queue must only ever carry
  // the Shopify scan.
  await inventoryQueue.add(
    RECONCILE_SHOPIFY_JOB,
    {},
    { repeat: { every: reconcileIntervalMs } }
  )
  console.log(
    `[seller-hub] scheduled Shopify reconciliation every ${reconcileIntervalMs}ms`
  )

  return {
    webhook: {
      webhookSecret: config.webhookSecret,
      orderQueue,
      inventoryQueue,
      priceQueue,
    },
    linked,
  }
}

/**
 * The gate `main()` uses: with no Shopify config nothing is created and one
 * log line says so, leaving boot identical to the Amazon-only service.
 */
export const startShopifyIfConfigured = async (
  config: ShopifyConfig | null,
  deps: Omit<StartShopifyDeps, "config">
): Promise<ShopifyRuntime | null> => {
  if (!config) {
    console.log(
      "[seller-hub] Shopify not configured (SHOPIFY_* env missing); skipping Shopify sync"
    )
    return null
  }
  // Failure-isolated: a broken Shopify setup (un-migrated column, Redis error,
  // ...) must never stop the Amazon sync from starting. Only the message is
  // logged, never the config (token/secret).
  try {
    return await startShopify({ ...deps, config })
  } catch (err) {
    console.error(
      "[seller-hub] Shopify startup failed, continuing without Shopify:",
      err instanceof Error ? err.message : String(err)
    )
    return null
  }
}
