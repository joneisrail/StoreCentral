import { resolveInternalSecret } from "./internal/secret.js"
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs"
import { decrypt } from "./crypto/secret-box.js"
import { createPool } from "./db/client.js"
import { runMigrations } from "./db/migrate.js"
import { loadEnv } from "./env.js"
import { MedusaAdminClient } from "./medusa/admin-client.js"
import { createRedisConnection } from "./queue/connection.js"
import { createSyncQueue, createSyncWorker } from "./queue/queues.js"
import { getOrder } from "./sp-api/orders.js"
import { SpApiClient } from "./sp-api/client.js"
import { SqsConsumer, type SqsClientLike } from "./sqs/consumer.js"
import { processInventorySyncJob } from "./sync/inventory-sync-processor.js"
import {
  processOrderSyncJob,
  type OrderSyncJobData,
} from "./sync/order-sync-processor.js"
import { pushPriceUpdate } from "./sync/push-price.js"
import { pushProductListing } from "./sync/push-product.js"
import { scheduleReconciliation } from "./sync/reconcile.js"
import {
  resolvePriceChannelListingId,
  type InventorySyncJobData,
  type PriceSyncJobData,
} from "./sync/resolve-channel-listing.js"
import { createConnectorManager, legacyManagerView } from "./connectors/manager.js"
import { createInternalHandler } from "./internal/connections.js"
import { createWebhookServer } from "./webhook/server.js"

// SP-API's North America regional endpoint. There's no per-region config
// anywhere yet (Task 3/4's `SpApiClient` just takes whatever `baseUrl` it's
// given), so this is the one sensible default until a real multi-region need
// shows up.
const SP_API_BASE_URL = "https://sellingpartnerapi-na.amazon.com"

// Reconciliation cadence per the brief: "hourly, per the spec's 'scheduled
// reconciliation' principle -- exact interval left as a sensible default,
// adjustable via env later if needed."
const RECONCILE_INTERVAL_MS = 60 * 60 * 1000

// `createWebhookServer` only builds the `http.Server`; binding it to a port
// is this bootstrap's job. Matches the port `apps/backend`'s
// `SELLER_HUB_WEBHOOK_URL` (its own `.env`) already points at for this dev
// environment. Not part of `SellerHubEnv` (Task 1's fixed, already-committed
// interface) since it's a local bind address, not a credential/connection
// string -- overridable via `WEBHOOK_PORT` without widening that interface.
const WEBHOOK_PORT = Number(process.env.WEBHOOK_PORT) || 7005

/**
 * Resolves the single `seller_hub.integration_account` row this
 * single-tenant service operates against, creating one (status
 * 'disconnected', no refresh token yet) if none exists. A real Amazon
 * connection (populating `lwa_refresh_token_encrypted` and flipping
 * `status` to 'connected') is Task 13's job -- this just guarantees every
 * worker below has an `integrationAccountId` to key its `channel_listing`/
 * `sync_job` rows against from the very first boot.
 */
const resolveIntegrationAccountId = async (
  pool: ReturnType<typeof createPool>
): Promise<string> => {
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM seller_hub.integration_account
     WHERE marketplace = 'amazon'
     ORDER BY created_at ASC
     LIMIT 1`
  )
  if (existing.rows[0]) {
    return existing.rows[0].id
  }

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO seller_hub.integration_account (marketplace, status)
     VALUES ('amazon', 'disconnected')
     RETURNING id`
  )
  return inserted.rows[0]!.id
}

const main = async (): Promise<void> => {
  console.log("[seller-hub] starting")

  const env = loadEnv()

  const pool = createPool(env)
  await runMigrations(pool)
  console.log("[seller-hub] migrations applied")

  const integrationAccountId = await resolveIntegrationAccountId(pool)
  console.log(
    `[seller-hub] using integration_account ${integrationAccountId}`
  )

  const medusaClient = new MedusaAdminClient({
    baseUrl: env.medusaBackendUrl,
    email: env.medusaAdminEmail,
    password: env.medusaAdminPassword,
  })

  // No real Amazon connection exists until Task 13's manual smoke checklist
  // runs -- `lwa_refresh_token_encrypted` is NULL at that point, same as
  // `AMAZON_LWA_CLIENT_ID`/`_SECRET` being `.env` placeholders. Building
  // `SpApiClient` anyway (rather than skipping it) is what lets every other
  // piece of the process boot and stay up: a push/order-sync job that hits
  // it will simply fail its SP-API call -- logged, retried per Task 7's
  // backoff -- instead of there being no SP-API client at all.
  const accountRow = await pool.query<{
    lwa_refresh_token_encrypted: string | null
  }>(
    `SELECT lwa_refresh_token_encrypted FROM seller_hub.integration_account WHERE id = $1`,
    [integrationAccountId]
  )
  const encryptedRefreshToken =
    accountRow.rows[0]?.lwa_refresh_token_encrypted ?? null
  const refreshToken = encryptedRefreshToken
    ? decrypt(encryptedRefreshToken, env.encryptionKey)
    : "placeholder-refresh-token"

  const spApiClient = new SpApiClient({
    baseUrl: SP_API_BASE_URL,
    refreshToken,
    clientId: env.amazonLwaClientId,
    clientSecret: env.amazonLwaClientSecret,
  })

  const redisConnection = createRedisConnection(env)

  const orderSyncQueue = createSyncQueue("order-sync", redisConnection)
  const inventorySyncQueue = createSyncQueue("inventory-sync", redisConnection)
  const priceSyncQueue = createSyncQueue("price-sync", redisConnection)
  // No producer enqueues onto this yet -- no webhook event or reconcile path
  // targets product-sync (only inventory/price have those). Created now
  // anyway so `createSyncWorker("product-sync", ...)` below has a live
  // queue to attach to; reserved for a future producer (e.g. an admin
  // action to list/relist a product) per the brief's Task 8 scope.
  const productSyncQueue = createSyncQueue("product-sync", redisConnection)

  let cachedSalesChannelId: string | null = null

  // See `sync/order-sync-processor.ts` for the full outcome contract: the
  // order's `sync_job` row is claimed before the sales channel is resolved
  // or SP-API is called, every failure is recorded on that row, and failures
  // are thrown classified (permanent vs transient) so BullMQ only retries
  // the ones that can succeed on retry.
  createSyncWorker<OrderSyncJobData>(
    "order-sync",
    redisConnection,
    async (job) => {
      const result = await processOrderSyncJob(job.data, {
        pool,
        medusaClient,
        integrationAccountId,
        resolveSalesChannelId: async () => {
          if (!cachedSalesChannelId) {
            cachedSalesChannelId =
              await medusaClient.findSalesChannelIdByName("Amazon")
          }
          return cachedSalesChannelId
        },
        fetchOrder: (amazonOrderId) => getOrder(spApiClient, amazonOrderId),
      })
      console.log(
        `[seller-hub] order-sync ${job.data.amazonOrderId}: ${result.status}` +
          (result.medusaOrderId ? ` (${result.medusaOrderId})` : "")
      )
    }
  )

  // See `sync/inventory-sync-processor.ts` for why this dispatches on the
  // job's data shape rather than its name: reconciliation's own corrective
  // job and its scan-trigger job share the literal name `"reconcile"`.
  createSyncWorker<InventorySyncJobData | Record<string, never>>(
    "inventory-sync",
    redisConnection,
    async (job) => {
      await processInventorySyncJob(job.data, {
        pool,
        medusaClient,
        spApiClient,
        integrationAccountId,
        inventoryQueue: inventorySyncQueue,
        priceQueue: priceSyncQueue,
      })
    }
  )

  createSyncWorker<PriceSyncJobData>(
    "price-sync",
    redisConnection,
    async (job) => {
      const channelListingId = await resolvePriceChannelListingId(job.data, {
        pool,
        medusaClient,
        integrationAccountId,
      })
      await pushPriceUpdate({
        pool,
        medusaClient,
        spApiClient,
        integrationAccountId,
        channelListingId,
      })
    }
  )

  createSyncWorker<{ channelListingId: string }>(
    "product-sync",
    redisConnection,
    async (job) => {
      await pushProductListing({
        pool,
        medusaClient,
        spApiClient,
        integrationAccountId,
        channelListingId: job.data.channelListingId,
      })
    }
  )

  console.log("[seller-hub] queues and workers started")

  // Optional Shopify / WooCommerce connectors. Connections saved from the admin
  // take precedence; SHOPIFY_* / WOOCOMMERCE_* env remain a fallback. applyAll
  // never throws and one connector failing never stops the other.
  const connectors = createConnectorManager({
    pool,
    medusaClient,
    encryptionKey: env.encryptionKey,
    redisConnection,
    reconcileIntervalMs: RECONCILE_INTERVAL_MS,
  })
  const manager = legacyManagerView(connectors, pool) // TEMP adapter (Task 5 removes)
  await manager.applyAll()

  // The internal API (used by the backend admin) is only mounted when a shared
  // secret is configured; otherwise /internal/* is a 404.
  const secretDecision = resolveInternalSecret(process.env.SELLER_HUB_INTERNAL_SECRET)
  const internalSecret = secretDecision.secret
  const internalHandler = internalSecret
    ? createInternalHandler({
        pool,
        manager: connectors,
        encryptionKey: env.encryptionKey,
        secret: internalSecret,
        publicUrl: process.env.SELLER_HUB_PUBLIC_URL,
      })
    : undefined
  if (!internalHandler) {
    console.log(
      secretDecision.reason === "too_short"
        ? "[seller-hub] internal API disabled (SELLER_HUB_INTERNAL_SECRET is too short, need at least 16 characters)"
        : "[seller-hub] internal API disabled (SELLER_HUB_INTERNAL_SECRET not set)"
    )
  }

  const webhookServer = createWebhookServer({
    inventoryQueue: inventorySyncQueue,
    priceQueue: priceSyncQueue,
    shopify: () => manager.getShopify()?.webhook ?? null,
    woocommerce: () => manager.getWooCommerce()?.webhook ?? null,
    ...(internalHandler ? { internalHandler } : {}),
  })
  await new Promise<void>((resolve) => {
    webhookServer.listen(WEBHOOK_PORT, () => resolve())
  })
  console.log(`[seller-hub] webhook server listening on port ${WEBHOOK_PORT}`)

  const sqsClient = new SQSClient({ region: env.awsRegion })
  const sqsClientLike: SqsClientLike = {
    // The real SDK's `Message.Body`/`ReceiptHandle` are typed optional
    // (AWS's own contract never actually omits either on a real message),
    // while `SqsClientLike` requires both -- so a message missing either is
    // filtered out here rather than widening `SqsClientLike`'s own contract
    // just to accommodate the SDK's looser typing.
    receiveMessage: async (input) => {
      const output = await sqsClient.send(new ReceiveMessageCommand(input))
      const messages = (output.Messages ?? []).flatMap((message) =>
        message.Body !== undefined && message.ReceiptHandle !== undefined
          ? [{ Body: message.Body, ReceiptHandle: message.ReceiptHandle }]
          : []
      )
      return { Messages: messages }
    },
    deleteMessage: (input) =>
      sqsClient.send(new DeleteMessageCommand(input)).then(() => undefined),
  }
  const sqsConsumer = new SqsConsumer({
    sqsClient: sqsClientLike,
    queueUrl: env.sqsQueueUrl,
    onOrderChange: async (amazonOrderId) => {
      await orderSyncQueue.add("import", { amazonOrderId })
    },
  })
  sqsConsumer.start()
  console.log(
    "[seller-hub] SQS consumer started (receiveMessage failures against a " +
      "placeholder SQS_QUEUE_URL are expected and non-fatal until Task 13's " +
      "AWS prerequisites are in place)"
  )

  await scheduleReconciliation(inventorySyncQueue, RECONCILE_INTERVAL_MS)
  console.log(
    `[seller-hub] scheduled reconciliation every ${RECONCILE_INTERVAL_MS}ms`
  )

  console.log("[seller-hub] startup complete")
}

main().catch((err) => {
  console.error("[seller-hub] fatal error during startup:", err)
  process.exit(1)
})
