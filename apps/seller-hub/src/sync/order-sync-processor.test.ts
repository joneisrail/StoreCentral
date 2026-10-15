import { afterAll, beforeAll, expect, test, vi } from "vitest"
import type { Pool } from "pg"
import { loadEnv } from "../env.js"
import { createPool } from "../db/client.js"
import { runMigrations } from "../db/migrate.js"
import { MedusaAdminClient } from "../medusa/admin-client.js"
import { DeferSyncError, PermanentSyncError } from "../queue/queues.js"
import { STALE_PROCESSING_MS } from "./import-order.js"
import {
  processOrderSyncJob,
  type OrderSyncProcessorDeps,
} from "./order-sync-processor.js"
import type { NormalizedAmazonOrder } from "./types.js"

const BASE_URL = process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000"
const ADMIN_EMAIL = process.env.MEDUSA_ADMIN_EMAIL!
const ADMIN_PASSWORD = process.env.MEDUSA_ADMIN_PASSWORD!
const MAPPED_SKU = "ORDER-SYNC-PROCESSOR-SKU"

let pool: Pool
let medusaClient: MedusaAdminClient
let integrationAccountId: string
let amazonSalesChannelId: string

const shippingAddress = {
  first_name: "Jane",
  last_name: "Doe",
  address_1: "1 Test St",
  city: "Seattle",
  country_code: "us",
  postal_code: "98101",
}

const newOrderId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const normalizedOrder = (
  amazonOrderId: string,
  sku = MAPPED_SKU
): NormalizedAmazonOrder => ({
  amazonOrderId,
  buyerEmail: "buyer@example.com",
  items: [{ sku, quantity: 1 }],
  shippingAddress,
})

const buildDeps = (
  overrides: Partial<OrderSyncProcessorDeps> = {}
): OrderSyncProcessorDeps => ({
  pool,
  medusaClient,
  integrationAccountId,
  resolveSalesChannelId: async () => amazonSalesChannelId,
  fetchOrder: async (amazonOrderId) => normalizedOrder(amazonOrderId),
  ...overrides,
})

const readSyncJob = async (amazonOrderId: string) => {
  const { rows } = await pool.query<{
    status: string
    attempts: number
    last_error: string | null
    medusa_entity_id: string | null
  }>(
    `SELECT status, attempts, last_error, medusa_entity_id FROM seller_hub.sync_job
     WHERE integration_account_id = $1 AND sync_type = 'order' AND external_id = $2`,
    [integrationAccountId, amazonOrderId]
  )
  return rows
}

const settle = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => null,
    (err: unknown) => err
  )

beforeAll(async () => {
  const env = loadEnv()
  pool = createPool(env)
  await runMigrations(pool)

  medusaClient = new MedusaAdminClient({
    baseUrl: BASE_URL,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  })

  const salesChannelId = await medusaClient.findSalesChannelIdByName("Amazon")
  if (!salesChannelId) {
    throw new Error(
      'No "Amazon" sales channel found. Run setup-amazon-channel.ts against the backend first.'
    )
  }
  amazonSalesChannelId = salesChannelId

  const loginResponse = await fetch(`${BASE_URL}/auth/user/emailpass`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })
  const { token } = (await loginResponse.json()) as { token: string }
  const productsResponse = await fetch(
    `${BASE_URL}/admin/products?limit=1&fields=id,*variants`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const { products } = (await productsResponse.json()) as {
    products: { id: string; variants: { id: string }[] }[]
  }
  const product = products[0]!
  const variant = product.variants[0]!

  const account = await pool.query<{ id: string }>(
    `INSERT INTO seller_hub.integration_account (marketplace, status)
     VALUES ('amazon', 'connected')
     RETURNING id`
  )
  integrationAccountId = account.rows[0]!.id

  await pool.query(
    `INSERT INTO seller_hub.channel_listing
       (integration_account_id, medusa_product_id, medusa_variant_id, external_sku, status)
     VALUES ($1, $2, $3, $4, 'published')`,
    [integrationAccountId, product.id, variant.id, MAPPED_SKU]
  )
}, 30_000)

afterAll(async () => {
  await pool.end()
})

test(
  "a missing Amazon sales channel is recorded as a failed sync_job and thrown as transient, before SP-API is called",
  async () => {
    const amazonOrderId = newOrderId("PROC-NO-CHANNEL")
    const fetchOrder = vi.fn()

    const error = await settle(
      processOrderSyncJob(
        { amazonOrderId },
        buildDeps({ resolveSalesChannelId: async () => null, fetchOrder })
      )
    )

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(PermanentSyncError)
    expect(fetchOrder).not.toHaveBeenCalled()

    const rows = await readSyncJob(amazonOrderId)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe("failed")
    expect(rows[0]!.last_error).toMatch(/sales channel/i)
  },
  20_000
)

test(
  "a sales-channel lookup that throws (Medusa unreachable) is recorded as a failed sync_job",
  async () => {
    const amazonOrderId = newOrderId("PROC-CHANNEL-THROWS")

    await expect(
      processOrderSyncJob(
        { amazonOrderId },
        buildDeps({
          resolveSalesChannelId: async () => {
            throw new TypeError("fetch failed")
          },
        })
      )
    ).rejects.toThrow(/fetch failed/)

    const rows = await readSyncJob(amazonOrderId)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe("failed")
    expect(rows[0]!.last_error).toMatch(/fetch failed/)
  },
  20_000
)

test(
  "SP-API getOrder failures are recorded on the sync_job row: 5xx as transient, then 4xx as permanent on the retry",
  async () => {
    const amazonOrderId = newOrderId("PROC-GETORDER-FAILS")

    const transient = await settle(
      processOrderSyncJob(
        { amazonOrderId },
        buildDeps({
          fetchOrder: async () => {
            throw new Error(
              'SP-API request "getOrder" failed with status 503: {}'
            )
          },
        })
      )
    )
    expect(transient).toBeInstanceOf(Error)
    expect(transient).not.toBeInstanceOf(PermanentSyncError)

    let rows = await readSyncJob(amazonOrderId)
    expect(rows[0]!.status).toBe("failed")
    expect(rows[0]!.last_error).toMatch(/503/)
    expect(rows[0]!.attempts).toBe(1)

    // BullMQ's retry reclaims the same failed row.
    await expect(
      processOrderSyncJob(
        { amazonOrderId },
        buildDeps({
          fetchOrder: async () => {
            throw new Error(
              'SP-API request "getOrder" failed with status 404: {}'
            )
          },
        })
      )
    ).rejects.toBeInstanceOf(PermanentSyncError)

    rows = await readSyncJob(amazonOrderId)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe("failed")
    expect(rows[0]!.last_error).toMatch(/404/)
    expect(rows[0]!.attempts).toBe(2)
  },
  20_000
)

test(
  "an unmapped SKU fails the job permanently (PermanentSyncError) with the failure recorded",
  async () => {
    const amazonOrderId = newOrderId("PROC-UNMAPPED")

    await expect(
      processOrderSyncJob(
        { amazonOrderId },
        buildDeps({
          fetchOrder: async (id) => normalizedOrder(id, "PROC-NO-SUCH-SKU"),
        })
      )
    ).rejects.toBeInstanceOf(PermanentSyncError)

    const rows = await readSyncJob(amazonOrderId)
    expect(rows[0]!.status).toBe("failed")
    expect(rows[0]!.last_error).toMatch(/PROC-NO-SUCH-SKU/)
  },
  20_000
)

test(
  "imports the order, and a repeat ORDER_CHANGE for it completes without calling SP-API again",
  async () => {
    const amazonOrderId = newOrderId("PROC-HAPPY")
    const fetchOrder = vi.fn(async (id: string) => normalizedOrder(id))

    const first = await processOrderSyncJob(
      { amazonOrderId },
      buildDeps({ fetchOrder })
    )
    expect(first.status).toBe("created")
    expect(first.medusaOrderId).toMatch(/^order_/)

    const second = await processOrderSyncJob(
      { amazonOrderId },
      buildDeps({ fetchOrder })
    )
    expect(second.status).toBe("skipped")
    expect(second.medusaOrderId).toBe(first.medusaOrderId)
    expect(fetchOrder).toHaveBeenCalledTimes(1)

    const rows = await readSyncJob(amazonOrderId)
    expect(rows[0]!.status).toBe("succeeded")
    expect(rows[0]!.medusa_entity_id).toBe(first.medusaOrderId)
  },
  30_000
)

test(
  "a live claim held by another attempt defers the job until that claim would go stale, instead of completing it",
  async () => {
    const amazonOrderId = newOrderId("PROC-IN-PROGRESS")
    await pool.query(
      `INSERT INTO seller_hub.sync_job
         (integration_account_id, sync_type, external_id, status, attempts)
       VALUES ($1, 'order', $2, 'processing', 1)`,
      [integrationAccountId, amazonOrderId]
    )
    const fetchOrder = vi.fn()

    const before = Date.now()
    const error = await settle(
      processOrderSyncJob({ amazonOrderId }, buildDeps({ fetchOrder }))
    )

    expect(error).toBeInstanceOf(DeferSyncError)
    const retryAt = (error as DeferSyncError).retryAt
    // Lease = row's updated_at (~now) + stale threshold; allow for clock
    // skew between this process and Postgres.
    expect(retryAt).toBeGreaterThan(before + STALE_PROCESSING_MS - 30_000)
    expect(retryAt).toBeLessThan(before + STALE_PROCESSING_MS + 30_000)
    expect(fetchOrder).not.toHaveBeenCalled()

    const rows = await readSyncJob(amazonOrderId)
    expect(rows[0]!.status).toBe("processing")
    expect(rows[0]!.attempts).toBe(1)
  },
  20_000
)
