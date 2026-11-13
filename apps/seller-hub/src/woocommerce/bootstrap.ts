import type { Redis as IORedis } from "ioredis"
import type { Pool } from "pg"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import { createSyncQueue, createSyncWorker } from "../queue/queues.js"
import {
  reconcileWooCommerce,
  RECONCILE_WOOCOMMERCE_JOB,
} from "../sync/reconcile-woocommerce.js"
import {
  resolveInventoryChannelListingId,
  resolvePriceChannelListingId,
  type InventorySyncJobData,
  type PriceSyncJobData,
} from "../sync/resolve-channel-listing.js"
import {
  linkWooCommerceListings,
  type LinkResult,
} from "../sync/woocommerce-link.js"
import {
  processWooOrderSyncJob,
  type WooOrderSyncJobData,
} from "../sync/woocommerce-order-sync-processor.js"
import { pushWooInventory } from "../sync/woocommerce-push-inventory.js"
import { pushWooPrice } from "../sync/woocommerce-push-price.js"
import type { WooCommerceWebhookDeps } from "../webhook/server.js"
import { resolveWooCommerceAccount } from "./account.js"
import { WooCommerceClient } from "./client.js"
import type { WooCommerceConfig } from "./config.js"
import { fetchWooOrder, fetchWooOrdersModifiedSince } from "./orders.js"

export { RECONCILE_WOOCOMMERCE_JOB }

export type StartWooCommerceDeps = {
  config: WooCommerceConfig
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
  /** When set, orders are attributed to this sales channel without a name lookup. */
  salesChannelId?: string | null
}

export type WooCommerceRuntime = {
  /** Pass to `createWebhookServer({ woocommerce })`. */
  webhook: WooCommerceWebhookDeps
  /** Settles when the boot-time SKU link finishes (null if it failed). */
  linked: Promise<LinkResult | null>
  /** Re-runs the SKU link and returns its result (rejects on failure). */
  relink: () => Promise<LinkResult>
  /** Closes all workers and queues and removes the repeatable reconcile job. Idempotent. */
  stop: () => Promise<void>
}

type JobLike<T> = { name: string; data: T }

/**
 * Starts the WooCommerce side of the service: resolves the account, builds the
 * client once, kicks off the one-off SKU link (log-only on failure, not
 * awaited so a slow store never delays the webhook server), creates the three
 * `woocommerce-*` queues and their workers, and schedules the reconcile.
 *
 * The reconcile is a repeatable job on the WOOCOMMERCE inventory queue (never
 * the Amazon one), routed by job name in that queue's worker; every other job
 * on it is a push job.
 */
export const startWooCommerce = async (
  deps: StartWooCommerceDeps
): Promise<WooCommerceRuntime> => {
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

  const account = await resolveWooCommerceAccount(pool, config, encryptionKey)
  console.log(`[seller-hub] using WooCommerce integration_account ${account.id}`)

  const wooClient = new WooCommerceClient({
    siteUrl: config.siteUrl,
    consumerKey: config.consumerKey,
    consumerSecret: config.consumerSecret,
    fetchImpl: deps.fetchImpl,
    sleep: deps.sleep,
  })
  const integrationAccountId = account.id

  const runLink = () =>
    linkWooCommerceListings({
    pool,
    medusaClient,
    wooClient,
    integrationAccountId,
  })

  const linked = runLink().then(
    (result) => {
      console.log(
        `[seller-hub] WooCommerce SKU link: ${result.linked} linked, ` +
          `${result.alreadyLinked} already linked, ${result.unmatched.length} ` +
          `unmatched, ${result.duplicates.length} duplicate`
      )
      return result
    },
    (err) => {
      console.error(
        "[seller-hub] WooCommerce SKU link failed:",
        err instanceof Error ? err.message : String(err)
      )
      return null
    }
  )

  const orderQueue = createQueue("woocommerce-order-sync", redisConnection)
  const inventoryQueue = createQueue("woocommerce-inventory-sync", redisConnection)
  const priceQueue = createQueue("woocommerce-price-sync", redisConnection)

  const queues = [orderQueue, inventoryQueue, priceQueue]
  const workers: Array<{ close: () => Promise<void> }> = []

  let cachedSalesChannelId: string | null = null

  // No job-name routing here: every job on this queue is an order import.
  workers.push(createWorker<WooOrderSyncJobData>(
    "woocommerce-order-sync",
    redisConnection,
    async (job: JobLike<WooOrderSyncJobData>) => {
      const result = await processWooOrderSyncJob(job.data, {
        pool,
        medusaClient,
        integrationAccountId,
        resolveSalesChannelId: async () => {
          if (deps.salesChannelId) return deps.salesChannelId
          if (!cachedSalesChannelId) {
            cachedSalesChannelId =
              await medusaClient.findSalesChannelIdByName("WordPress")
          }
          return cachedSalesChannelId
        },
        fetchOrder: (wooOrderId) => fetchWooOrder(wooClient, wooOrderId),
      })
      console.log(
        `[seller-hub] woocommerce-order-sync ${job.data.wooOrderId}: ${result.status}` +
          (result.medusaOrderId ? ` (${result.medusaOrderId})` : "")
      )
    }
  ))

  workers.push(createWorker<InventorySyncJobData | Record<string, never>>(
    "woocommerce-inventory-sync",
    redisConnection,
    async (job: JobLike<InventorySyncJobData | Record<string, never>>) => {
      if (job.name === RECONCILE_WOOCOMMERCE_JOB) {
        const result = await reconcileWooCommerce({
          pool,
          medusaClient,
          integrationAccountId,
          inventoryQueue,
          priceQueue,
          orderQueue,
          fetchOrdersSince: (sinceIso) =>
            fetchWooOrdersModifiedSince(wooClient, sinceIso),
        })
        console.log(
          `[seller-hub] reconcile-woocommerce: ${JSON.stringify(result)}`
        )
        return
      }
      const channelListingId = await resolveInventoryChannelListingId(
        job.data as InventorySyncJobData,
        { pool, medusaClient, integrationAccountId }
      )
      await pushWooInventory({
        pool,
        medusaClient,
        wooClient,
        integrationAccountId,
        channelListingId,
      })
    }
  ))

  workers.push(createWorker<PriceSyncJobData>(
    "woocommerce-price-sync",
    redisConnection,
    async (job: JobLike<PriceSyncJobData>) => {
      const channelListingId = await resolvePriceChannelListingId(job.data, {
        pool,
        medusaClient,
        integrationAccountId,
      })
      await pushWooPrice({
        pool,
        medusaClient,
        wooClient,
        integrationAccountId,
        channelListingId,
      })
    }
  ))
  console.log("[seller-hub] WooCommerce queues and workers started")

  // Added directly (not via scheduleReconciliation, which also adds the Amazon
  // "reconcile" job): this queue must only ever carry the WooCommerce scan.
  await inventoryQueue.add(
    RECONCILE_WOOCOMMERCE_JOB,
    {},
    { repeat: { every: reconcileIntervalMs } }
  )
  console.log(
    `[seller-hub] scheduled WooCommerce reconciliation every ${reconcileIntervalMs}ms`
  )

  let stopped = false
  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    const attempt = async (what: string, fn: () => Promise<unknown>) => {
      try {
        await fn()
      } catch (err) {
        console.error(
          `[seller-hub] WooCommerce stop: ${what} failed:`,
          err instanceof Error ? err.message : String(err)
        )
      }
    }
    await attempt("remove reconcile schedule", () =>
      inventoryQueue.removeRepeatable(RECONCILE_WOOCOMMERCE_JOB, {
        every: reconcileIntervalMs,
      })
    )
    for (const w of workers) await attempt("close worker", () => w.close())
    for (const q of queues) await attempt("close queue", () => q.close())
  }

  return {
    webhook: {
      webhookSecret: config.webhookSecret,
      orderQueue,
      inventoryQueue,
      priceQueue,
    },
    linked,
    relink: () => runLink(),
    stop,
  }
}

/**
 * The gate `main()` uses: with no WooCommerce config nothing is created and
 * one log line says so, leaving boot identical to the Amazon-only service.
 */
export const startWooCommerceIfConfigured = async (
  config: WooCommerceConfig | null,
  deps: Omit<StartWooCommerceDeps, "config">
): Promise<WooCommerceRuntime | null> => {
  if (!config) {
    console.log(
      "[seller-hub] WooCommerce not configured (WOOCOMMERCE_* env missing); skipping WooCommerce sync"
    )
    return null
  }
  // Failure-isolated: a broken WooCommerce setup must never stop the Amazon
  // sync from starting. Only the message is logged, never the config.
  try {
    return await startWooCommerce({ ...deps, config })
  } catch (err) {
    console.error(
      "[seller-hub] WooCommerce startup failed, continuing without WooCommerce:",
      err instanceof Error ? err.message : String(err)
    )
    return null
  }
}
