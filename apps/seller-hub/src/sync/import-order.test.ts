import { beforeAll, expect, test, vi } from "vitest"
import { loadEnv } from "../env.js"
import { createPool } from "../db/client.js"
import { runMigrations } from "../db/migrate.js"
import { MedusaAdminClient } from "../medusa/admin-client.js"
import { PermanentSyncError } from "../queue/queues.js"
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

test("importAmazonOrder throws PermanentSyncError for an unmapped SKU without creating a partial order", async () => {
  const order: NormalizedAmazonOrder = {
    amazonOrderId: "TEST-UNMAPPED-" + Date.now(),
    buyerEmail: "buyer@example.com",
    items: [{ sku: "NO-SUCH-SKU", quantity: 1 }],
    shippingAddress,
  }

  const error = await importAmazonOrder(order, deps).then(
    () => null,
    (err: unknown) => err
  )

  // Permanent: retrying with the same mapping can't succeed, so BullMQ
  // must not burn its attempts on it.
  expect(error).toBeInstanceOf(PermanentSyncError)
  expect((error as Error).message).toMatch(/channel_listing|sku/i)

  const { rows } = await pool.query(
    `SELECT status, last_error, medusa_entity_id FROM seller_hub.sync_job
     WHERE integration_account_id = $1 AND sync_type = 'order' AND external_id = $2`,
    [integrationAccountId, order.amazonOrderId]
  )
  expect(rows[0].status).toBe("failed")
  expect(rows[0].last_error).toMatch(/NO-SUCH-SKU/)
  expect(rows[0].medusa_entity_id).toBeNull()

  // The real proof that no partial/real order was created: zero Medusa
  // orders exist carrying this amazon_order_id metadata.
  const count = await countOrdersWithAmazonOrderId(order.amazonOrderId)
  expect(count).toBe(0)
}, 20_000)

test("importAmazonOrder skips a Canceled order without creating any Medusa order, and records it as succeeded (no-op by design, not a failure)", async () => {
  const order: NormalizedAmazonOrder = {
    amazonOrderId: "TEST-CANCELED-" + Date.now(),
    orderStatus: "Canceled",
    buyerEmail: "buyer@example.com",
    items: [{ sku: MAPPED_SKU, quantity: 1 }],
    shippingAddress,
  }

  const result = await importAmazonOrder(order, deps)

  expect(result.status).toBe("skipped")
  expect(result.medusaOrderId).toBeUndefined()
  expect(result.reason).toMatch(/Canceled/)

  const { rows } = await pool.query(
    `SELECT status, medusa_entity_id FROM seller_hub.sync_job
     WHERE integration_account_id = $1 AND sync_type = 'order' AND external_id = $2`,
    [integrationAccountId, order.amazonOrderId]
  )
  expect(rows[0].status).toBe("succeeded")
  expect(rows[0].medusa_entity_id).toBeNull()

  const count = await countOrdersWithAmazonOrderId(order.amazonOrderId)
  expect(count).toBe(0)
}, 20_000)

test("importAmazonOrder defers a Pending (unpaid) order instead of importing it, and the failed row can be retried once it's ready", async () => {
  const amazonOrderId = "TEST-PENDING-" + Date.now()
  const pendingOrder: NormalizedAmazonOrder = {
    amazonOrderId,
    orderStatus: "Pending",
    buyerEmail: "buyer@example.com",
    items: [{ sku: MAPPED_SKU, quantity: 1 }],
    shippingAddress,
  }

  const error = await importAmazonOrder(pendingOrder, deps).then(
    () => null,
    (err: unknown) => err
  )

  // Transient, not PermanentSyncError: a later Amazon notification for the
  // same order (once payment clears and status advances) must still be able
  // to retry this via the normal `failed`-row reclaim path.
  expect(error).not.toBeInstanceOf(PermanentSyncError)
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toMatch(/Pending/)

  const { rows: failedRows } = await pool.query(
    `SELECT status FROM seller_hub.sync_job
     WHERE integration_account_id = $1 AND sync_type = 'order' AND external_id = $2`,
    [integrationAccountId, amazonOrderId]
  )
  expect(failedRows[0].status).toBe("failed")
  expect(await countOrdersWithAmazonOrderId(amazonOrderId)).toBe(0)

  // Amazon later reports the same order as Unshipped (payment cleared) —
  // the same amazonOrderId reclaims the failed row and actually imports.
  const readyOrder: NormalizedAmazonOrder = {
    ...pendingOrder,
    orderStatus: "Unshipped",
  }
  const result = await importAmazonOrder(readyOrder, deps)

  expect(result.status).toBe("created")
  expect(result.medusaOrderId).toBeDefined()
  expect(await countOrdersWithAmazonOrderId(amazonOrderId)).toBe(1)
}, 25_000)

test(
  "importAmazonOrder sets each line item's unit_price from the normalized order when present",
  async () => {
    const order: NormalizedAmazonOrder = {
      amazonOrderId: "TEST-UNITPRICE-" + Date.now(),
      orderStatus: "Unshipped",
      buyerEmail: "buyer@example.com",
      items: [{ sku: MAPPED_SKU, quantity: 2, unitPrice: 12.5 }],
      shippingAddress,
    }

    const result = await importAmazonOrder(order, deps)
    expect(result.status).toBe("created")

    const response = await fetch(
      `${BASE_URL}/admin/orders/${result.medusaOrderId}?fields=id,*items`,
      { headers: authHeaders }
    )
    const body = (await response.json()) as {
      order: { items: { unit_price: number }[] }
    }

    expect(body.order.items[0]!.unit_price).toBe(12.5)
  },
  20_000
)

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

test(
  "importAmazonOrder retries a previously failed job once the mapping is fixed, instead of reporting it skipped forever",
  async () => {
    const amazonOrderId = "TEST-RETRY-" + Date.now()
    const retrySku = "RETRY-SKU-" + Date.now()
    const order: NormalizedAmazonOrder = {
      amazonOrderId,
      buyerEmail: "buyer@example.com",
      items: [{ sku: retrySku, quantity: 1 }],
      shippingAddress,
    }

    // First attempt fails: the sku isn't mapped yet.
    await expect(importAmazonOrder(order, deps)).rejects.toBeInstanceOf(
      PermanentSyncError
    )

    const { rows: failedRows } = await pool.query(
      `SELECT status, attempts FROM seller_hub.sync_job
       WHERE integration_account_id = $1 AND sync_type = 'order' AND external_id = $2`,
      [integrationAccountId, amazonOrderId]
    )
    expect(failedRows[0].status).toBe("failed")
    const attemptsAfterFirstFailure = failedRows[0].attempts

    // Fix the problem: map the sku, same as an operator resolving the
    // failed job (a later ORDER_CHANGE notification then retries it).
    const productsResponse = await fetch(
      `${BASE_URL}/admin/products?limit=1&fields=id,title,*variants`,
      { headers: authHeaders }
    )
    const { products } = (await productsResponse.json()) as {
      products: { id: string; variants: { id: string }[] }[]
    }
    const variant = products[0]!.variants[0]!
    await pool.query(
      `INSERT INTO seller_hub.channel_listing
         (integration_account_id, medusa_product_id, medusa_variant_id, external_sku, status)
       VALUES ($1, $2, $3, $4, 'published')`,
      [integrationAccountId, products[0]!.id, variant.id, retrySku]
    )

    // Retrying with the same amazonOrderId must now actually proceed and
    // create a real order — not report "skipped" as if already handled.
    const second = await importAmazonOrder(order, deps)
    expect(second.status).toBe("created")
    expect(second.medusaOrderId).toBeDefined()
    expect(second.medusaOrderId).toMatch(/^order_/)

    const { rows: succeededRows } = await pool.query(
      `SELECT status, attempts, medusa_entity_id, last_error FROM seller_hub.sync_job
       WHERE integration_account_id = $1 AND sync_type = 'order' AND external_id = $2`,
      [integrationAccountId, amazonOrderId]
    )
    expect(succeededRows).toHaveLength(1)
    expect(succeededRows[0].status).toBe("succeeded")
    expect(succeededRows[0].medusa_entity_id).toBe(second.medusaOrderId)
    expect(succeededRows[0].last_error).toBeNull()
    expect(succeededRows[0].attempts).toBeGreaterThan(attemptsAfterFirstFailure)

    const count = await countOrdersWithAmazonOrderId(amazonOrderId)
    expect(count).toBe(1)
  },
  25_000
)

test(
  "two concurrent retries of the same failed job still only ever produce one real order",
  async () => {
    const amazonOrderId = "TEST-RETRY-CONCURRENT-" + Date.now()
    const retrySku = "RETRY-CONCURRENT-SKU-" + Date.now()
    const order: NormalizedAmazonOrder = {
      amazonOrderId,
      buyerEmail: "buyer@example.com",
      items: [{ sku: retrySku, quantity: 1 }],
      shippingAddress,
    }

    // First attempt fails: unmapped sku.
    await expect(importAmazonOrder(order, deps)).rejects.toBeInstanceOf(
      PermanentSyncError
    )

    // Fix the mapping.
    const productsResponse = await fetch(
      `${BASE_URL}/admin/products?limit=1&fields=id,title,*variants`,
      { headers: authHeaders }
    )
    const { products } = (await productsResponse.json()) as {
      products: { id: string; variants: { id: string }[] }[]
    }
    const variant = products[0]!.variants[0]!
    await pool.query(
      `INSERT INTO seller_hub.channel_listing
         (integration_account_id, medusa_product_id, medusa_variant_id, external_sku, status)
       VALUES ($1, $2, $3, $4, 'published')`,
      [integrationAccountId, products[0]!.id, variant.id, retrySku]
    )

    // Two genuinely concurrent retries racing to claim the same `failed`
    // row — only one may win the atomic `UPDATE ... WHERE status = 'failed'`
    // claim, so at most one proceeds to create a real Medusa order.
    const [retryA, retryB] = await Promise.all([
      importAmazonOrder(order, deps),
      importAmazonOrder(order, deps),
    ])

    const statuses = [retryA.status, retryB.status].sort()
    expect(statuses).toEqual(["created", "skipped"])

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

// ---------------------------------------------------------------------------
// Reclaim safety (final-review Finding 2): a `failed` or stale `processing`
// row must never be retried into a second real Medusa order.
// ---------------------------------------------------------------------------

/** A fresh client per test, so per-test spies can't leak across tests. */
const newClient = (): MedusaAdminClient =>
  new MedusaAdminClient({
    baseUrl: BASE_URL,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  })

const newMappedOrder = (prefix: string): NormalizedAmazonOrder => ({
  amazonOrderId: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  buyerEmail: "buyer@example.com",
  items: [{ sku: MAPPED_SKU, quantity: 1 }],
  shippingAddress,
})

const readSyncJob = async (amazonOrderId: string) => {
  const { rows } = await pool.query<{
    status: string
    attempts: number
    medusa_entity_id: string | null
    last_error: string | null
  }>(
    `SELECT status, attempts, medusa_entity_id, last_error FROM seller_hub.sync_job
     WHERE integration_account_id = $1 AND sync_type = 'order' AND external_id = $2`,
    [integrationAccountId, amazonOrderId]
  )
  expect(rows).toHaveLength(1)
  return rows[0]!
}

const settle = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => null,
    (err: unknown) => err
  )

test(
  "reclaiming a failed row whose order already exists in Medusa records it as succeeded instead of creating a duplicate (success UPDATE lost)",
  async () => {
    const order = newMappedOrder("TEST-RECLAIM-EXISTING")
    const first = await importAmazonOrder(order, deps)
    expect(first.status).toBe("created")

    // Simulate the finding's scenario (b): the convert succeeded, but the
    // `succeeded` UPDATE was lost and the catch's `failed` UPDATE landed
    // instead -- and with no draft id on the row, so only the
    // findOrderByMetadata check can catch it.
    await pool.query(
      `UPDATE seller_hub.sync_job
       SET status = 'failed', medusa_entity_id = NULL, last_error = 'simulated DB blip'
       WHERE integration_account_id = $1 AND sync_type = 'order' AND external_id = $2`,
      [integrationAccountId, order.amazonOrderId]
    )

    const client = newClient()
    const findSpy = vi.spyOn(client, "findOrderByMetadata")
    const createSpy = vi.spyOn(client, "createDraftOrder")
    const convertSpy = vi.spyOn(client, "convertDraftOrderToOrder")

    const retry = await importAmazonOrder(order, { ...deps, medusaClient: client })

    expect(retry.status).toBe("recovered")
    expect(retry.medusaOrderId).toBe(first.medusaOrderId)
    expect(findSpy).toHaveBeenCalledWith(
      "amazon_order_id",
      order.amazonOrderId,
      expect.objectContaining({
        key: "amazon_account_id",
        value: integrationAccountId,
      })
    )
    expect(createSpy).not.toHaveBeenCalled()
    expect(convertSpy).not.toHaveBeenCalled()

    const row = await readSyncJob(order.amazonOrderId)
    expect(row.status).toBe("succeeded")
    expect(row.medusa_entity_id).toBe(first.medusaOrderId)
    expect(row.last_error).toBeNull()

    expect(await countOrdersWithAmazonOrderId(order.amazonOrderId)).toBe(1)
  },
  30_000
)

test(
  "a convert that landed server-side but looked failed client-side is recovered on retry, not duplicated",
  async () => {
    const order = newMappedOrder("TEST-RECLAIM-AMBIGUOUS-CONVERT")

    // The finding's scenario (a): convert succeeds in Medusa, then the
    // client sees a network error -- and the network is still down for the
    // same attempt's own follow-up check, so only the retry can settle it.
    const flaky = newClient()
    vi.spyOn(flaky, "convertDraftOrderToOrder").mockImplementationOnce(
      async (draftOrderId) => {
        await MedusaAdminClient.prototype.convertDraftOrderToOrder.call(
          flaky,
          draftOrderId
        )
        throw new TypeError("fetch failed")
      }
    )
    vi.spyOn(flaky, "getOrderById").mockRejectedValueOnce(
      new TypeError("fetch failed")
    )

    const firstError = await settle(
      importAmazonOrder(order, { ...deps, medusaClient: flaky })
    )
    // Transient: a plain Error, so BullMQ retries it.
    expect(firstError).toBeInstanceOf(Error)
    expect(firstError).not.toBeInstanceOf(PermanentSyncError)

    const failedRow = await readSyncJob(order.amazonOrderId)
    expect(failedRow.status).toBe("failed")
    expect(failedRow.last_error).toMatch(/fetch failed/)
    // The draft id was persisted before the convert was attempted.
    expect(failedRow.medusa_entity_id).toMatch(/^order_/)

    const client = newClient()
    const createSpy = vi.spyOn(client, "createDraftOrder")
    const convertSpy = vi.spyOn(client, "convertDraftOrderToOrder")

    const retry = await importAmazonOrder(order, { ...deps, medusaClient: client })

    expect(retry.status).toBe("recovered")
    // Same id: a draft and the order it converts into share one id.
    expect(retry.medusaOrderId).toBe(failedRow.medusa_entity_id)
    expect(createSpy).not.toHaveBeenCalled()
    expect(convertSpy).not.toHaveBeenCalled()

    const row = await readSyncJob(order.amazonOrderId)
    expect(row.status).toBe("succeeded")
    expect(row.medusa_entity_id).toBe(retry.medusaOrderId)

    expect(await countOrdersWithAmazonOrderId(order.amazonOrderId)).toBe(1)
  },
  30_000
)

test(
  "reclaiming a failed row after a transient Medusa failure, with no order in Medusa, runs the normal create flow exactly once",
  async () => {
    const order = newMappedOrder("TEST-RECLAIM-NOTHING")

    const flaky = newClient()
    vi.spyOn(flaky, "createDraftOrder").mockRejectedValueOnce(
      new Error(
        "Medusa admin request POST /admin/draft-orders failed with status 503: {}"
      )
    )
    const firstError = await settle(
      importAmazonOrder(order, { ...deps, medusaClient: flaky })
    )
    expect(firstError).toBeInstanceOf(Error)
    expect(firstError).not.toBeInstanceOf(PermanentSyncError)

    const failedRow = await readSyncJob(order.amazonOrderId)
    expect(failedRow.status).toBe("failed")
    expect(failedRow.last_error).toMatch(/503/)
    expect(failedRow.medusa_entity_id).toBeNull()
    expect(await countOrdersWithAmazonOrderId(order.amazonOrderId)).toBe(0)

    const client = newClient()
    const findSpy = vi.spyOn(client, "findOrderByMetadata")
    const createSpy = vi.spyOn(client, "createDraftOrder")
    const convertSpy = vi.spyOn(client, "convertDraftOrderToOrder")

    const retry = await importAmazonOrder(order, { ...deps, medusaClient: client })

    expect(retry.status).toBe("created")
    expect(findSpy).toHaveBeenCalledTimes(1)
    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(convertSpy).toHaveBeenCalledTimes(1)

    const row = await readSyncJob(order.amazonOrderId)
    expect(row.status).toBe("succeeded")
    expect(row.medusa_entity_id).toBe(retry.medusaOrderId)
    expect(row.attempts).toBe(failedRow.attempts + 1)

    expect(await countOrdersWithAmazonOrderId(order.amazonOrderId)).toBe(1)
  },
  30_000
)

test(
  "a 4xx from Medusa is classified permanent (PermanentSyncError), not retried",
  async () => {
    const order = newMappedOrder("TEST-MEDUSA-4XX")

    const client = newClient()
    vi.spyOn(client, "createDraftOrder").mockRejectedValueOnce(
      new Error(
        "Medusa admin request POST /admin/draft-orders failed with status 400: {}"
      )
    )
    await expect(
      importAmazonOrder(order, { ...deps, medusaClient: client })
    ).rejects.toBeInstanceOf(PermanentSyncError)
    expect((await readSyncJob(order.amazonOrderId)).status).toBe("failed")
  },
  30_000
)

test(
  "a retry after a convert that failed before landing converts the persisted draft instead of creating a second one",
  async () => {
    const order = newMappedOrder("TEST-RECLAIM-REUSE-DRAFT")

    const flaky = newClient()
    vi.spyOn(flaky, "convertDraftOrderToOrder").mockRejectedValueOnce(
      new Error(
        "Medusa admin request POST /admin/draft-orders/x/convert-to-order failed with status 502: {}"
      )
    )
    const firstError = await settle(
      importAmazonOrder(order, { ...deps, medusaClient: flaky })
    )
    expect(firstError).toBeInstanceOf(Error)
    expect(firstError).not.toBeInstanceOf(PermanentSyncError)

    const failedRow = await readSyncJob(order.amazonOrderId)
    expect(failedRow.status).toBe("failed")
    const draftId = failedRow.medusa_entity_id
    expect(draftId).toMatch(/^order_/)
    expect(await countOrdersWithAmazonOrderId(order.amazonOrderId)).toBe(0)

    const client = newClient()
    const createSpy = vi.spyOn(client, "createDraftOrder")
    const convertSpy = vi.spyOn(client, "convertDraftOrderToOrder")

    const retry = await importAmazonOrder(order, { ...deps, medusaClient: client })

    expect(retry.status).toBe("created")
    expect(retry.medusaOrderId).toBe(draftId)
    expect(createSpy).not.toHaveBeenCalled()
    expect(convertSpy).toHaveBeenCalledWith(draftId)

    const row = await readSyncJob(order.amazonOrderId)
    expect(row.status).toBe("succeeded")
    expect(row.medusa_entity_id).toBe(draftId)

    expect(await countOrdersWithAmazonOrderId(order.amazonOrderId)).toBe(1)
  },
  30_000
)

test(
  "a stale processing row (holder killed after converting) is reclaimed and recovered, not duplicated",
  async () => {
    const order = newMappedOrder("TEST-STALE-EXISTING")
    const first = await importAmazonOrder(order, deps)
    expect(first.status).toBe("created")

    // The holder was killed after the convert landed but before its
    // `succeeded` UPDATE: the row is left `processing`, long untouched.
    await pool.query(
      `UPDATE seller_hub.sync_job
       SET status = 'processing', updated_at = now() - interval '10 minutes'
       WHERE integration_account_id = $1 AND sync_type = 'order' AND external_id = $2`,
      [integrationAccountId, order.amazonOrderId]
    )

    const client = newClient()
    const createSpy = vi.spyOn(client, "createDraftOrder")

    const retry = await importAmazonOrder(order, { ...deps, medusaClient: client })

    expect(retry.status).toBe("recovered")
    expect(retry.medusaOrderId).toBe(first.medusaOrderId)
    expect(createSpy).not.toHaveBeenCalled()
    expect((await readSyncJob(order.amazonOrderId)).status).toBe("succeeded")
    expect(await countOrdersWithAmazonOrderId(order.amazonOrderId)).toBe(1)
  },
  30_000
)

test(
  "a stale processing row (holder killed before creating anything) is reclaimed and imported exactly once",
  async () => {
    const order = newMappedOrder("TEST-STALE-NOTHING")
    await pool.query(
      `INSERT INTO seller_hub.sync_job
         (integration_account_id, sync_type, external_id, status, attempts, updated_at)
       VALUES ($1, 'order', $2, 'processing', 1, now() - interval '10 minutes')`,
      [integrationAccountId, order.amazonOrderId]
    )

    const client = newClient()
    const createSpy = vi.spyOn(client, "createDraftOrder")

    const retry = await importAmazonOrder(order, { ...deps, medusaClient: client })

    expect(retry.status).toBe("created")
    expect(createSpy).toHaveBeenCalledTimes(1)
    const row = await readSyncJob(order.amazonOrderId)
    expect(row.status).toBe("succeeded")
    expect(row.attempts).toBe(2)
    expect(await countOrdersWithAmazonOrderId(order.amazonOrderId)).toBe(1)
  },
  30_000
)

test("a fresh processing row is left to its holder: skipped with zero Medusa calls", async () => {
  const order = newMappedOrder("TEST-FRESH-PROCESSING")
  await pool.query(
    `INSERT INTO seller_hub.sync_job
       (integration_account_id, sync_type, external_id, status, attempts)
     VALUES ($1, 'order', $2, 'processing', 1)`,
    [integrationAccountId, order.amazonOrderId]
  )

  const client = newClient()
  const findSpy = vi.spyOn(client, "findOrderByMetadata")
  const createSpy = vi.spyOn(client, "createDraftOrder")

  const result = await importAmazonOrder(order, { ...deps, medusaClient: client })

  expect(result.status).toBe("skipped")
  expect(findSpy).not.toHaveBeenCalled()
  expect(createSpy).not.toHaveBeenCalled()
  const row = await readSyncJob(order.amazonOrderId)
  expect(row.status).toBe("processing")
  expect(row.attempts).toBe(1)
})

test(
  "a holder whose claim was taken over mid-flight stops before converting and records nothing",
  async () => {
    const order = newMappedOrder("TEST-LEASE-LOST")

    const client = newClient()
    vi.spyOn(client, "createDraftOrder").mockImplementationOnce(async (input) => {
      const draft = await MedusaAdminClient.prototype.createDraftOrder.call(
        client,
        input
      )
      // While this holder was inside createDraftOrder, its claim went stale
      // and another attempt reclaimed the row (attempts bumped).
      await pool.query(
        `UPDATE seller_hub.sync_job SET attempts = attempts + 1, updated_at = now()
         WHERE integration_account_id = $1 AND sync_type = 'order' AND external_id = $2`,
        [integrationAccountId, order.amazonOrderId]
      )
      return draft
    })
    const convertSpy = vi.spyOn(client, "convertDraftOrderToOrder")

    const result = await importAmazonOrder(order, { ...deps, medusaClient: client })

    expect(result.status).toBe("skipped")
    expect(convertSpy).not.toHaveBeenCalled()
    // The new holder's row is untouched: not flipped to failed/succeeded,
    // and no draft id written over it.
    const row = await readSyncJob(order.amazonOrderId)
    expect(row.status).toBe("processing")
    expect(row.attempts).toBe(2)
    expect(row.medusa_entity_id).toBeNull()
    expect(await countOrdersWithAmazonOrderId(order.amazonOrderId)).toBe(0)
  },
  30_000
)

test(
  "a convert that landed server-side but errored client-side is confirmed within the same attempt when Medusa is reachable",
  async () => {
    const order = newMappedOrder("TEST-AMBIGUOUS-CONVERT-SAME-ATTEMPT")

    const client = newClient()
    vi.spyOn(client, "convertDraftOrderToOrder").mockImplementationOnce(
      async (draftOrderId) => {
        await MedusaAdminClient.prototype.convertDraftOrderToOrder.call(
          client,
          draftOrderId
        )
        throw new Error("The operation was aborted due to timeout")
      }
    )
    const createSpy = vi.spyOn(client, "createDraftOrder")

    const result = await importAmazonOrder(order, { ...deps, medusaClient: client })

    expect(result.status).toBe("created")
    expect(result.medusaOrderId).toMatch(/^order_/)
    expect(createSpy).toHaveBeenCalledTimes(1)

    const row = await readSyncJob(order.amazonOrderId)
    expect(row.status).toBe("succeeded")
    expect(row.medusa_entity_id).toBe(result.medusaOrderId)
    expect(await countOrdersWithAmazonOrderId(order.amazonOrderId)).toBe(1)
  },
  30_000
)
