import { beforeAll, expect, test } from "vitest"
import { loadEnv } from "../env.js"
import { createPool } from "../db/client.js"
import { runMigrations } from "../db/migrate.js"
import { MedusaAdminClient } from "../medusa/admin-client.js"
import { importAmazonOrder } from "./import-order.js"
import type { NormalizedAmazonOrder } from "./types.js"
import type { Pool } from "pg"

const BASE_URL = process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000"
const ADMIN_EMAIL = process.env.MEDUSA_ADMIN_EMAIL!
const ADMIN_PASSWORD = process.env.MEDUSA_ADMIN_PASSWORD!
const MAPPED_SKU = "TEST-SKU-1"

let pool: Pool
let medusaClient: MedusaAdminClient
let authHeaders: Record<string, string>
let amazonSalesChannelId: string
let integrationAccountId: string
let deps: {
  pool: Pool
  integrationAccountId: string
  salesChannelId: string
  medusaClient: MedusaAdminClient
}

const shippingAddress = {
  first_name: "Jane",
  last_name: "Doe",
  address_1: "1 Test St",
  city: "Seattle",
  country_code: "us",
  postal_code: "98101",
}

/**
 * Fetches the full admin order list (fields id + metadata) and returns how
 * many of them carry the given `amazon_order_id` metadata value. Used to
 * verify real Medusa state directly, independent of our own DB bookkeeping
 * or `findOrderByMetadata` (which only ever reports a single match).
 */
const countOrdersWithAmazonOrderId = async (
  amazonOrderId: string
): Promise<number> => {
  const response = await fetch(
    `${BASE_URL}/admin/orders?limit=100&order=-created_at&fields=id,metadata`,
    { headers: authHeaders }
  )
  const body = (await response.json()) as {
    orders: { id: string; metadata?: Record<string, unknown> | null }[]
  }
  return body.orders.filter(
    (order) => order.metadata?.amazon_order_id === amazonOrderId
  ).length
}

beforeAll(async () => {
  const env = loadEnv()
  pool = createPool(env)
  await runMigrations(pool)

  medusaClient = new MedusaAdminClient({
    baseUrl: BASE_URL,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  })
  await medusaClient.login()

  const loginResponse = await fetch(`${BASE_URL}/auth/user/emailpass`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })
  const { token } = (await loginResponse.json()) as { token: string }
  authHeaders = { Authorization: `Bearer ${token}` }

  const channelsResponse = await fetch(
    `${BASE_URL}/admin/sales-channels?limit=100&fields=id,name`,
    { headers: authHeaders }
  )
  const { sales_channels } = (await channelsResponse.json()) as {
    sales_channels: { id: string; name: string }[]
  }
  const amazonChannel = sales_channels.find((c) => c.name === "Amazon")
  if (!amazonChannel) {
    throw new Error(
      'No "Amazon" sales channel found. Run setup-amazon-channel.ts against the backend first.'
    )
  }
  amazonSalesChannelId = amazonChannel.id

  const productsResponse = await fetch(
    `${BASE_URL}/admin/products?limit=1&fields=id,title,*variants`,
    { headers: authHeaders }
  )
  const { products } = (await productsResponse.json()) as {
    products: { id: string; variants: { id: string }[] }[]
  }
  const product = products[0]
  const variant = product?.variants?.[0]
  if (!product || !variant) {
    throw new Error("No product/variant found in the demo catalog.")
  }

  // Step 1 of the brief: seed a real integration_account row, then a
  // channel_listing row mapping a known test SKU to that real variant.
  const accountResult = await pool.query<{ id: string }>(
    `INSERT INTO seller_hub.integration_account (marketplace, status)
     VALUES ('amazon', 'connected')
     RETURNING id`
  )
  integrationAccountId = accountResult.rows[0]!.id

  await pool.query(
    `INSERT INTO seller_hub.channel_listing
       (integration_account_id, medusa_product_id, medusa_variant_id, external_sku, status)
     VALUES ($1, $2, $3, $4, 'published')`,
    [integrationAccountId, product.id, variant.id, MAPPED_SKU]
  )

  deps = {
    pool,
    integrationAccountId,
    salesChannelId: amazonSalesChannelId,
    medusaClient,
  }
}, 30_000)

test("importAmazonOrder creates a real Medusa order on first import", async () => {
  const order: NormalizedAmazonOrder = {
    amazonOrderId: "TEST-IMPORT-" + Date.now(),
    buyerEmail: "buyer@example.com",
    items: [{ sku: MAPPED_SKU, quantity: 1 }],
    shippingAddress,
  }

  const result = await importAmazonOrder(order, deps)

  expect(result.status).toBe("created")
  expect(result.medusaOrderId).toBeDefined()
  expect(result.medusaOrderId).toMatch(/^order_/)

  const { rows } = await pool.query(
    `SELECT status, medusa_entity_id FROM seller_hub.sync_job
     WHERE integration_account_id = $1 AND sync_type = 'order' AND external_id = $2`,
    [integrationAccountId, order.amazonOrderId]
  )
  expect(rows[0].status).toBe("succeeded")
  expect(rows[0].medusa_entity_id).toBe(result.medusaOrderId)
}, 20_000)

test("importAmazonOrder is idempotent — re-importing the same Amazon order is skipped", async () => {
  const order: NormalizedAmazonOrder = {
    amazonOrderId: "TEST-DUPE-" + Date.now(),
    buyerEmail: "buyer@example.com",
    items: [{ sku: MAPPED_SKU, quantity: 1 }],
    shippingAddress,
  }

  const first = await importAmazonOrder(order, deps)
  const second = await importAmazonOrder(order, deps)

  expect(first.status).toBe("created")
  expect(second.status).toBe("skipped")
  expect(second.medusaOrderId).toBe(first.medusaOrderId)

  // Confirm this is reflected in real Medusa state, not just our own DB
  // bookkeeping: exactly one real order carries this amazon_order_id.
  const count = await countOrdersWithAmazonOrderId(order.amazonOrderId)
  expect(count).toBe(1)
}, 25_000)

test("importAmazonOrder reports needs_attention for an unmapped SKU without creating a partial order", async () => {
  const order: NormalizedAmazonOrder = {
    amazonOrderId: "TEST-UNMAPPED-" + Date.now(),
    buyerEmail: "buyer@example.com",
    items: [{ sku: "NO-SUCH-SKU", quantity: 1 }],
    shippingAddress,
  }

  const result = await importAmazonOrder(order, deps)

  expect(result.status).toBe("needs_attention")
  expect(result.reason).toMatch(/channel_listing|sku/i)
  expect(result.medusaOrderId).toBeUndefined()

  const { rows } = await pool.query(
    `SELECT status, last_error, medusa_entity_id FROM seller_hub.sync_job
     WHERE integration_account_id = $1 AND sync_type = 'order' AND external_id = $2`,
    [integrationAccountId, order.amazonOrderId]
  )
  expect(rows[0].status).toBe("failed")
  expect(rows[0].medusa_entity_id).toBeNull()

  // The real proof that no partial/real order was created: zero Medusa
  // orders exist carrying this amazon_order_id metadata.
  const count = await countOrdersWithAmazonOrderId(order.amazonOrderId)
  expect(count).toBe(0)
}, 20_000)

test(
  "importAmazonOrder enforces idempotency via the DB unique constraint under real concurrent duplicate calls",
  async () => {
    const amazonOrderId = "TEST-CONCURRENT-" + Date.now()
    const order: NormalizedAmazonOrder = {
      amazonOrderId,
      buyerEmail: "buyer@example.com",
      items: [{ sku: MAPPED_SKU, quantity: 1 }],
      shippingAddress,
    }

    // Two genuinely concurrent calls for the same Amazon order, racing on
    // the same Postgres pool — this is what actually exercises the UNIQUE
    // constraint rather than a racy SELECT-then-INSERT check in our own
    // process: both calls run their initial SELECT before either has
    // inserted anything, so only the DB constraint on the INSERT can be
    // what prevents both from proceeding to create a Medusa order.
    const [first, second] = await Promise.all([
      importAmazonOrder(order, deps),
      importAmazonOrder(order, deps),
    ])

    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual(["created", "skipped"])

    const winner = first.status === "created" ? first : second
    expect(winner.medusaOrderId).toBeDefined()

    // The decisive check: exactly one real Medusa order was created for
    // this Amazon order, no matter how the two calls raced.
    const count = await countOrdersWithAmazonOrderId(amazonOrderId)
    expect(count).toBe(1)

    const { rows } = await pool.query(
      `SELECT status FROM seller_hub.sync_job
       WHERE integration_account_id = $1 AND sync_type = 'order' AND external_id = $2`,
      [integrationAccountId, amazonOrderId]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe("succeeded")
  },
  25_000
)
