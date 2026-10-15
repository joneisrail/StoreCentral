import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs"
import { decrypt } from "./crypto/secret-box.js"
import { createPool } from "./db/client.js"
import { runMigrations } from "./db/migrate.js"
import { loadEnv, type SellerHubEnv } from "./env.js"
import { MedusaAdminClient } from "./medusa/admin-client.js"
import { createRedisConnection } from "./queue/connection.js"
import { createSyncQueue, createSyncWorker } from "./queue/queues.js"
import { getOrder } from "./sp-api/orders.js"
import { SpApiClient } from "./sp-api/client.js"
import { SqsConsumer, type SqsClientLike } from "./sqs/consumer.js"
import { importAmazonOrder } from "./sync/import-order.js"
import { pushInventoryUpdate } from "./sync/push-inventory.js"
import { pushPriceUpdate } from "./sync/push-price.js"
import { pushProductListing } from "./sync/push-product.js"
import { reconcile, scheduleReconciliation } from "./sync/reconcile.js"
import {
  resolveInventoryChannelListingId,
  resolvePriceChannelListingId,
  type InventorySyncJobData,
  type PriceSyncJobData,
} from "./sync/resolve-channel-listing.js"
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

/**
 * Looks up the id of Medusa's "Amazon" sales channel, used by order import
 * (`importAmazonOrder`'s `salesChannelId`). Logs and returns `null` on any
 * failure (Medusa unreachable, no such channel yet) rather than throwing --
 * this is called lazily from the order-sync worker below, and a failure here
 * must fail that one job, not the whole process.
 */
const resolveAmazonSalesChannelId = async (
  env: SellerHubEnv
): Promise<string | null> => {
  try {
    const loginResponse = await fetch(
      `${env.medusaBackendUrl}/auth/user/emailpass`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: env.medusaAdminEmail,
          password: env.medusaAdminPassword,
        }),
      }
    )
    if (!loginResponse.ok) {
      throw new Error(
        `Medusa admin login failed with status ${loginResponse.status}`
      )
    }
    const { token } = (await loginResponse.json()) as { token: string }

    const channelsResponse = await fetch(
      `${env.medusaBackendUrl}/admin/sales-channels?limit=100&fields=id,name`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!channelsResponse.ok) {
      throw new Error(
        `Medusa sales-channels lookup failed with status ${channelsResponse.status}`
      )
    }
    const { sales_channels } = (await channelsResponse.json()) as {
      sales_channels: { id: string; name: string }[]
    }
    return sales_channels.find((channel) => channel.name === "Amazon")?.id ?? null
  } catch (err) {
    console.error(
      "[seller-hub] failed to resolve the Amazon sales channel:",
      err
    )
    return null
  }
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
  const productSyncQueue = createSyncQueue("product-sync", redisConnection)

  let cachedSalesChannelId: string | null = null

  createSyncWorker<{ amazonOrderId: string }>(
    "order-sync",
    redisConnection,
    async (job) => {
      const order = await getOrder(spApiClient, job.data.amazonOrderId)

      if (!cachedSalesChannelId) {
        cachedSalesChannelId = await resolveAmazonSalesChannelId(env)
      }
      if (!cachedSalesChannelId) {
        throw new Error(
          "Amazon sales channel not found in Medusa -- cannot import order"
        )
      }

      await importAmazonOrder(order, {
        pool,
        integrationAccountId,
        salesChannelId: cachedSalesChannelId,
        medusaClient,
      })
    }
  )

  // Jobs on this queue arrive in one of three shapes: the webhook flow's
  // `{ inventoryLevelId }`, reconciliation's corrective `{ channelListingId }`,
  // or the empty-payload `"reconcile"` job `scheduleReconciliation` adds on
  // its own repeat schedule below. See `sync/resolve-channel-listing.ts` for
  // why `{ inventoryLevelId }` needs an extra Medusa Admin API hop that
  // `{ channelListingId }`/`{ variantId }` (price-sync, below) don't.
  createSyncWorker<InventorySyncJobData | Record<string, never>>(
    "inventory-sync",
    redisConnection,
    async (job) => {
      if (job.name === "reconcile") {
        await reconcile({
          pool,
          medusaClient,
          integrationAccountId,
          inventoryQueue: inventorySyncQueue,
          priceQueue: priceSyncQueue,
        })
        return
      }

      const channelListingId = await resolveInventoryChannelListingId(
        job.data as InventorySyncJobData,
        { pool, medusaClient, integrationAccountId }
      )
      await pushInventoryUpdate({
        pool,
        medusaClient,
        spApiClient,
        integrationAccountId,
        channelListingId,
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

  const webhookServer = createWebhookServer({
    inventoryQueue: inventorySyncQueue,
    priceQueue: priceSyncQueue,
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
