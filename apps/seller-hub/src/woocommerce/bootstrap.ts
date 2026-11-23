import type { Redis as IORedis } from "ioredis"
import type { Pool } from "pg"
import {
  previewImport,
  runImport,
  type ImportOutcome,
  type ImportPreview,
} from "../sync/channel-import-run.js"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import { createSyncQueue, createSyncWorker, PermanentSyncError } from "../queue/queues.js"
import { readAutoSyncPrice } from "../sync/auto-sync-price.js"
import { processChannelPushJob } from "../sync/channel-push.js"
import type { ChannelPushJobData } from "../sync/channel-push-enqueue.js"
import { processTrackingJob } from "../sync/tracking/processor.js"
import { createWooCommerceTrackingPush } from "../sync/tracking/woocommerce-push.js"
import type { TrackingJobData, TrackingPush } from "../sync/tracking/types.js"
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
import { listWooCatalog, setWooPrice, setWooStock } from "./products.js"

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
  /** Pushes shipment tracking to the channel; defaults to the WooCommerce order-note push. */
  trackingPush?: TrackingPush
  /** When set, orders are attributed to this sales channel without a name lookup. */
  salesChannelId?: string | null
  /**
   * A managed connection row to run against (no `resolve*Account`). Its id
   * suffixes the queue names so several accounts never share a queue. Without
   * it the legacy single-account behaviour and queue names are unchanged.
   */
  accountId?: string
  /** Log label for the account; defaults to `accountId`. */
  displayId?: string
}

export type WooCommerceRuntime = {
  /** Pass to `createWebhookServer({ woocommerce })`. */
  webhook: WooCommerceWebhookDeps
  /** Settles when the boot-time SKU link finishes (null if it failed). */
  linked: Promise<LinkResult | null>
  /** Re-runs the SKU link and returns its result (rejects on failure). */
  relink: () => Promise<LinkResult>
  /** Read-only: groups the channel catalogue against the store. */
  previewImport: () => Promise<ImportPreview>
  /** Creates draft products for the selected unmatched listings (never writes to the channel). */
  importListings: (skus: string[] | "all") => Promise<ImportOutcome>
  /** Closes all workers and queues and removes the repeatable reconcile job. Idempotent. */
  stop: () => Promise<void>
}

type JobLike<T> = {
  name: string
  data: T
  attemptsMade?: number
  opts?: { attempts?: number }
}

const isFinalAttempt = (job: JobLike<unknown>): boolean =>
  job.opts?.attempts !== undefined &&
  (job.attemptsMade ?? 0) + 1 >= job.opts.attempts

// WooCommerce ids are stored as strings on channel_listing; REST paths need integers.
const parseWooId = (value: string, what: string, listingId: string): number => {
  const n = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(n)) {
    throw new PermanentSyncError(
      `channel_listing ${listingId} has an invalid WooCommerce ${what} "${value}"`
    )
  }
  return n
}

/** Product/variation address of a listing: id plus optional parent id. */
const wooTarget = (listing: {
  id: string
  external_variant_id: string | null
  external_parent_id: string | null
}): { id: number; parentId: number | null } => {
  if (!listing.external_variant_id) {
    throw new PermanentSyncError(`channel_listing ${listing.id} has no WooCommerce id`)
  }
  return {
    id: parseWooId(listing.external_variant_id, "id", listing.id),
    parentId:
      listing.external_parent_id === null
        ? null
        : parseWooId(listing.external_parent_id, "parent id", listing.id),
  }
}

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

  const account = deps.accountId
    ? { id: deps.accountId }
    : await resolveWooCommerceAccount(pool, config, encryptionKey)
  console.log(`[seller-hub] using WooCommerce integration_account ${deps.displayId ?? account.id}`)
  const suffix = deps.accountId ? `-${deps.accountId}` : ""

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

  const orderQueue = createQueue(`woocommerce-order-sync${suffix}`, redisConnection)
  const inventoryQueue = createQueue(`woocommerce-inventory-sync${suffix}`, redisConnection)
  const priceQueue = createQueue(`woocommerce-price-sync${suffix}`, redisConnection)
  const trackingQueue = createQueue(`woocommerce-tracking-sync${suffix}`, redisConnection)

  const channelPushQueue = createQueue(`woocommerce-channel-push${suffix}`, redisConnection)

  const queues = [orderQueue, inventoryQueue, priceQueue, trackingQueue, channelPushQueue]
  const workers: Array<{ close: () => Promise<void> }> = []

  let cachedSalesChannelId: string | null = null

  // No job-name routing here: every job on this queue is an order import.
  workers.push(createWorker<WooOrderSyncJobData>(
    `woocommerce-order-sync${suffix}`,
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
    `woocommerce-inventory-sync${suffix}`,
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
    `woocommerce-price-sync${suffix}`,
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
  workers.push(createWorker<TrackingJobData>(
    `woocommerce-tracking-sync${suffix}`,
    redisConnection,
    async (job: JobLike<TrackingJobData>) => {
      const result = await processTrackingJob(job.data, {
        pool,
        medusaClient,
        integrationAccountId,
        marketplace: "woocommerce",
        push: deps.trackingPush ?? createWooCommerceTrackingPush(wooClient),
      })
      console.log(`[seller-hub] woocommerce-tracking-sync: ${result.status}`)
    }
  ))
  // Per-channel push: the channel's own stock/price (not the variant total).
  workers.push(createWorker<ChannelPushJobData>(
    `woocommerce-channel-push${suffix}`,
    redisConnection,
    async (job: JobLike<ChannelPushJobData>) => {
      await processChannelPushJob(job.data, {
        pool,
        medusaClient,
        integrationAccountId,
        finalAttempt: isFinalAttempt(job),
        pushStock: async (listing, stock) => {
          const target = wooTarget(listing)
          await setWooStock(wooClient, { ...target, quantity: stock })
        },
        pushPrice: async (listing, price) => {
          const target = wooTarget(listing)
          // Assumption: push-values carries no currency, so channel/effective
          // prices are taken to be in the store base currency, checked here.
          // WooCommerce prices carry no currency, so a non-USD store price is a
          // permanent failure rather than a silently wrong amount.
          const pricing = await medusaClient.getVariantPricing(listing.medusa_variant_id)
          if (pricing.currencyCode.toLowerCase() !== "usd") {
            throw new PermanentSyncError(
              `Medusa price for variant ${listing.medusa_variant_id} is in ${pricing.currencyCode}; only USD is supported for WooCommerce`
            )
          }
          await setWooPrice(wooClient, { ...target, price: price.toFixed(2) })
        },
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
      trackingQueue,
      integrationAccountId,
      channelPushQueue,
      salesChannelId: deps.salesChannelId ?? null,
      autoSyncPrice: () => readAutoSyncPrice(pool, integrationAccountId),
    },
    linked,
    relink: () => runLink(),
    previewImport: () => previewImport({ channel: () => listWooCatalog(wooClient), medusaClient }),
    importListings: (skus) =>
      runImport({
        pool,
        medusaClient,
        integrationAccountId,
        channel: () => listWooCatalog(wooClient),
        skus,
      }),
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
