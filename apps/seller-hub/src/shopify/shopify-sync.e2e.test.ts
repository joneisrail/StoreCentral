import crypto from "node:crypto"
import type http from "node:http"
import type { AddressInfo } from "node:net"
import type { Redis as IORedis } from "ioredis"
import type { Pool } from "pg"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import { createWebhookServer } from "../webhook/server.js"
import { loadShopifyConfig, type ShopifyConfig } from "./config.js"
import {
  startShopify,
  startShopifyIfConfigured,
  type ShopifyRuntime,
  type StartShopifyDeps,
} from "./bootstrap.js"

// In-process end to end: fake Shopify GraphQL (injected fetchImpl), fake Medusa
// admin client, in-memory pool and in-memory queues. The real webhook server,
// the real Shopify client and the real push/import/reconcile code run.

const ENC_KEY = "00".repeat(32)
const SECRET = "whsec_test"
const LOCATION = "gid://shopify/Location/1"
const ORDER_GID = "gid://shopify/Order/1001"
const config: ShopifyConfig = {
  shopDomain: "shop.myshopify.com",
  accessToken: "shpat_test",
  webhookSecret: SECRET,
  locationId: LOCATION,
}

// ---- in-memory queue -------------------------------------------------------

type Added = { name: string; data: any; opts?: any }
class FakeQueue {
  added: Added[] = []
  constructor(readonly name: string) {}
  async add(name: string, data: any, opts?: any) {
    // BullMQ collapses a second add with a jobId that is still queued.
    if (opts?.jobId && this.added.some((a) => a.opts?.jobId === opts.jobId)) {
      return {}
    }
    this.added.push({ name, data, opts })
    return {}
  }
}

// ---- in-memory pool --------------------------------------------------------

type SyncJob = {
  id: string
  acct: string
  type: string
  external_id: string
  status: string
  attempts: number
  last_error: string | null
  medusa_entity_id: string | null
}
type Listing = {
  id: string
  acct: string
  medusa_product_id: string
  medusa_variant_id: string
  external_sku: string
  external_variant_id: string
  external_inventory_item_id: string
  last_synced_quantity: number | null
  last_synced_price: number | null
  price_rule: null
}

const makePool = () => {
  const listings: Listing[] = []
  const jobs: SyncJob[] = []
  let account: { id: string; last_synced_at: Date | null } | null = null
  let seq = 0
  const upsertJob = (acct: string, type: string, ext: string, status: string) => {
    let job = jobs.find((j) => j.acct === acct && j.type === type && j.external_id === ext)
    if (job) {
      job.status = status
      job.attempts += 1
    } else {
      job = {
        id: `job-${++seq}`,
        acct,
        type,
        external_id: ext,
        status,
        attempts: 1,
        last_error: null,
        medusa_entity_id: null,
      }
      jobs.push(job)
    }
    return job
  }
  const byId = (id: unknown) => jobs.find((j) => j.id === id)

  const query = async (sql: string, p: any[] = []): Promise<any> => {
    // integration_account
    if (/FROM seller_hub\.integration_account\s+WHERE marketplace = 'shopify'/.test(sql)) {
      return { rows: account ? [{ id: account.id }] : [] }
    }
    if (/INSERT INTO seller_hub\.integration_account/.test(sql)) {
      account = { id: "acct-shopify", last_synced_at: null }
      return { rows: [{ id: account.id, shop_domain: p[0], shopify_location_id: p[1] }] }
    }
    if (/UPDATE seller_hub\.integration_account\s+SET shop_domain/.test(sql)) {
      return { rows: [{ id: p[3], shop_domain: p[0], shopify_location_id: p[1] }] }
    }
    if (/SELECT last_synced_at FROM seller_hub\.integration_account/.test(sql)) {
      return { rows: [{ last_synced_at: account?.last_synced_at ?? null }] }
    }
    if (/SET last_synced_at/.test(sql)) {
      account!.last_synced_at = p[0]
      return { rowCount: 1, rows: [] }
    }
    // channel_listing
    if (/INSERT INTO seller_hub\.channel_listing/.test(sql)) {
      const [acct, productId, variantId, sku, extVariant, extItem] = p
      if (listings.some((l) => l.acct === acct && l.external_sku === sku)) {
        return { rowCount: 0, rows: [] }
      }
      listings.push({
        id: `cl-${listings.length + 1}`,
        acct,
        medusa_product_id: productId,
        medusa_variant_id: variantId,
        external_sku: sku,
        external_variant_id: extVariant,
        external_inventory_item_id: extItem,
        last_synced_quantity: null,
        last_synced_price: null,
        price_rule: null,
      })
      return { rowCount: 1, rows: [] }
    }
    if (/SELECT external_sku, medusa_variant_id\s+FROM seller_hub\.channel_listing/.test(sql)) {
      return {
        rows: listings.filter((l) => l.acct === p[0] && (p[1] as string[]).includes(l.external_sku)),
      }
    }
    if (/SELECT id FROM seller_hub\.channel_listing\s+WHERE integration_account_id = \$1 AND medusa_variant_id/.test(sql)) {
      return { rows: listings.filter((l) => l.acct === p[0] && l.medusa_variant_id === p[1]) }
    }
    if (/SELECT medusa_variant_id, external_inventory_item_id/.test(sql) || /SELECT medusa_variant_id, external_variant_id, price_rule/.test(sql)) {
      return { rows: listings.filter((l) => l.id === p[0] && l.acct === p[1]) }
    }
    if (/SELECT id, medusa_variant_id, price_rule, last_synced_quantity, last_synced_price/.test(sql)) {
      return { rows: listings.filter((l) => l.acct === p[0]) }
    }
    if (/SET last_synced_quantity/.test(sql)) {
      listings.find((l) => l.id === p[1])!.last_synced_quantity = p[0]
      return { rowCount: 1 }
    }
    if (/SET last_synced_price/.test(sql)) {
      listings.find((l) => l.id === p[1])!.last_synced_price = p[0]
      return { rowCount: 1 }
    }
    // sync_job
    if (/INSERT INTO seller_hub\.sync_job/.test(sql)) {
      if (/VALUES \(\$1, 'product'/.test(sql)) {
        const job = upsertJob(p[0], "product", p[1], "failed")
        job.last_error = p[2]
        return { rowCount: 1, rows: [] }
      }
      if (/VALUES \(\$1, 'order'/.test(sql)) {
        if (jobs.some((j) => j.acct === p[0] && j.type === "order" && j.external_id === p[1])) {
          return { rows: [] }
        }
        const job = upsertJob(p[0], "order", p[1], "processing")
        return { rows: [{ id: job.id, attempts: job.attempts, medusa_entity_id: null }] }
      }
      if (/VALUES \(\$1, \$2, \$3, 'failed'/.test(sql)) {
        const job = upsertJob(p[0], p[1], p[2], "failed")
        job.last_error = p[3]
        return { rowCount: 1, rows: [] }
      }
      const type = /'(inventory|price)'/.exec(sql)![1]!
      const job = upsertJob(p[0], type, p[1], "processing")
      return { rows: [{ id: job.id }] }
    }
    if (/SET status = 'processing', attempts = attempts \+ 1/.test(sql)) {
      const job = jobs.find((j) => j.acct === p[0] && j.type === "order" && j.external_id === p[1])
      if (job && ["failed", "pending"].includes(job.status)) {
        job.status = "processing"
        job.attempts += 1
        return { rows: [{ id: job.id, attempts: job.attempts, medusa_entity_id: job.medusa_entity_id }] }
      }
      return { rows: [] }
    }
    if (/SELECT status, medusa_entity_id,/.test(sql)) {
      const job = jobs.find((j) => j.acct === p[0] && j.type === "order" && j.external_id === p[1])
      return { rows: job ? [{ ...job, lease_expires_at: Date.now() + 60_000 }] : [] }
    }
    if (/SET updated_at = now\(\)/.test(sql)) {
      const job = byId(p[0])
      const ok = job?.status === "processing" && job.attempts === p[1]
      return { rowCount: ok ? 1 : 0 }
    }
    if (/SET medusa_entity_id = \$1, updated_at/.test(sql)) {
      const job = byId(p[1])
      const ok = job?.status === "processing" && job.attempts === p[2]
      if (ok) job!.medusa_entity_id = p[0]
      return { rowCount: ok ? 1 : 0 }
    }
    if (/SET status = 'succeeded'/.test(sql)) {
      const job = byId(p[1])
      const ok = !!job && (p.length < 3 || (job.status === "processing" && job.attempts === p[2]))
      if (ok) {
        job!.status = "succeeded"
        job!.medusa_entity_id = p[0]
        job!.last_error = null
      }
      return { rowCount: ok ? 1 : 0 }
    }
    if (/SET status = 'failed'/.test(sql)) {
      const job = byId(p[1])
      const ok = !!job && (p.length < 3 || (job.status === "processing" && job.attempts === p[2]))
      if (ok) {
        job!.status = "failed"
        job!.last_error = p[0]
      }
      return { rowCount: ok ? 1 : 0 }
    }
    throw new Error(`unexpected sql: ${sql}`)
  }
  return { pool: { query } as unknown as Pool, listings, jobs }
}

// ---- fake Medusa -----------------------------------------------------------

type FakeOrder = { id: string; isDraft: boolean; metadata: Record<string, unknown> }

const makeMedusa = () => {
  const orders: FakeOrder[] = []
  let seq = 0
  let quantity = 7
  let price = 12.5
  const client = {
    orders,
    setQuantity: (q: number) => (quantity = q),
    setPrice: (a: number) => (price = a),
    listVariantsBySku: vi.fn(async () => [
      { variantId: "variant_1", productId: "prod_1", sku: "SKU-1" },
      { variantId: "variant_2", productId: "prod_2", sku: "ONLY-IN-MEDUSA" },
    ]),
    findSalesChannelIdByName: vi.fn(async (name: string) =>
      name === "Shopify" ? "sc_shopify" : null
    ),
    findVariantIdByInventoryLevelId: vi.fn(async (id: string) =>
      id === "ilev_1" ? "variant_1" : null
    ),
    getVariantInventory: vi.fn(async () => ({ quantity })),
    getVariantPricing: vi.fn(async () => ({ amount: price, currencyCode: "usd" })),
    findOrderByMetadata: vi.fn(async (key: string, value: string) => {
      const m = orders.find((o) => !o.isDraft && o.metadata[key] === value)
      return m ? { id: m.id } : null
    }),
    getOrderById: vi.fn(async (id: string) => {
      const o = orders.find((x) => x.id === id)
      return o ? { id: o.id, isDraftOrder: o.isDraft } : null
    }),
    createDraftOrder: vi.fn(async (input: any) => {
      const o = { id: `order_${++seq}`, isDraft: true, metadata: input.metadata }
      orders.push(o)
      return { id: o.id }
    }),
    convertDraftOrderToOrder: vi.fn(async (id: string) => {
      orders.find((o) => o.id === id)!.isDraft = false
      return { id }
    }),
  }
  return client as typeof client & MedusaAdminClient
}

// ---- fake Shopify GraphQL --------------------------------------------------

const makeShopify = () => {
  const calls = {
    setQuantities: [] as any[],
    priceUpdates: [] as any[],
    orderFetches: 0,
  }
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    const { query, variables } = JSON.parse(init.body) as { query: string; variables: any }
    const reply = (data: unknown) =>
      new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    if (query.includes("productVariants(first")) {
      return reply({
        productVariants: {
          nodes: [
            { id: "gid://shopify/ProductVariant/1", sku: "SKU-1", price: "10.00", inventoryItem: { id: "gid://shopify/InventoryItem/1" } },
            { id: "gid://shopify/ProductVariant/2", sku: "ONLY-IN-SHOPIFY", price: "5.00", inventoryItem: { id: "gid://shopify/InventoryItem/2" } },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      })
    }
    if (query.includes("inventorySetQuantities")) {
      calls.setQuantities.push(variables)
      return reply({ inventorySetQuantities: { userErrors: [] } })
    }
    if (query.includes("ProductOfVariant")) {
      return reply({ productVariant: { product: { id: "gid://shopify/Product/1" } } })
    }
    if (query.includes("productVariantsBulkUpdate")) {
      calls.priceUpdates.push(variables)
      return reply({ productVariantsBulkUpdate: { userErrors: [] } })
    }
    if (/query Order\(/.test(query)) {
      calls.orderFetches++
      return reply({
        order: {
          id: ORDER_GID,
          name: "#1001",
          displayFinancialStatus: "PAID",
          currencyCode: "USD",
          cancelledAt: null,
          email: "buyer@example.com",
          shippingAddress: { firstName: "Ann", lastName: "Lee", address1: "1 Main", city: "Reno", countryCodeV2: "US", zip: "89501" },
          lineItems: {
            pageInfo: { hasNextPage: false },
            nodes: [{ sku: "SKU-1", quantity: 2, discountedUnitPriceSet: { shopMoney: { amount: "8.50", currencyCode: "USD" } } }],
          },
        },
      })
    }
    if (/query Orders\(/.test(query)) {
      return reply({ orders: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } })
    }
    throw new Error(`unexpected Shopify query: ${query}`)
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

// ---- harness ---------------------------------------------------------------

type Processor = (job: { name: string; data: any }) => Promise<void>

let server: http.Server | null = null
afterEach(async () => {
  if (server) await new Promise((r) => server!.close(r))
  server = null
  vi.restoreAllMocks()
})

const harness = async () => {
  vi.spyOn(console, "log").mockImplementation(() => {})
  const db = makePool()
  const medusa = makeMedusa()
  const shopify = makeShopify()
  const queues = new Map<string, FakeQueue>()
  const processors = new Map<string, Processor>()
  const deps: Omit<StartShopifyDeps, "config"> = {
    pool: db.pool,
    medusaClient: medusa,
    encryptionKey: ENC_KEY,
    redisConnection: {} as IORedis,
    reconcileIntervalMs: 3_600_000,
    fetchImpl: shopify.fetchImpl,
    sleep: async () => {},
    createQueue: ((name: string) => {
      const q = new FakeQueue(name)
      queues.set(name, q)
      return q
    }) as unknown as StartShopifyDeps["createQueue"],
    createWorker: ((name: string, _c: unknown, processor: Processor) => {
      processors.set(name, processor)
      return {}
    }) as unknown as StartShopifyDeps["createWorker"],
  }
  return { db, medusa, shopify, queues, processors, deps }
}

const boot = async () => {
  const h = await harness()
  const runtime = (await startShopify({ ...h.deps, config })) as ShopifyRuntime
  await runtime.linked
  const amazonInventory = new FakeQueue("inventory-sync")
  const amazonPrice = new FakeQueue("price-sync")
  server = createWebhookServer({
    inventoryQueue: amazonInventory as never,
    priceQueue: amazonPrice as never,
    shopify: runtime.webhook,
  })
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()))
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`
  return { ...h, runtime, amazonInventory, amazonPrice, base }
}

const sign = (body: string, secret = SECRET) =>
  crypto.createHmac("sha256", secret).update(body).digest("base64")

const orderWebhook = (base: string, body: string, signature: string) =>
  fetch(`${base}/webhooks/shopify`, {
    method: "POST",
    headers: { "X-Shopify-Hmac-Sha256": signature, "X-Shopify-Topic": "orders/create" },
    body,
  })

const medusaEvent = (base: string, event: string, id: string) =>
  fetch(`${base}/webhooks/medusa`, {
    method: "POST",
    body: JSON.stringify({ event, data: { id } }),
  })

// ---- tests -----------------------------------------------------------------

test("links Shopify variants to StoreCentral variants by SKU only", async () => {
  const { db } = await boot()
  expect(db.listings).toHaveLength(1)
  expect(db.listings[0]).toMatchObject({
    acct: "acct-shopify",
    medusa_variant_id: "variant_1",
    external_sku: "SKU-1",
    external_variant_id: "gid://shopify/ProductVariant/1",
    external_inventory_item_id: "gid://shopify/InventoryItem/1",
  })
  // a Shopify SKU with no StoreCentral match is recorded, not linked
  expect(db.jobs.filter((j) => j.type === "product").map((j) => j.external_id)).toEqual([
    "ONLY-IN-SHOPIFY",
  ])
})

test("a signed orders/create webhook imports exactly one order; a duplicate delivery imports none", async () => {
  const { base, queues, processors, medusa, shopify } = await boot()
  const body = JSON.stringify({ id: 1001, admin_graphql_api_id: ORDER_GID })

  expect((await orderWebhook(base, body, sign(body))).status).toBe(200)
  const orderQueue = queues.get("shopify-order-sync")!
  expect(orderQueue.added).toHaveLength(1)
  expect(orderQueue.added[0]!.data).toEqual({ shopifyOrderId: ORDER_GID })

  // same delivery again while the job is still queued collapses on the job id
  expect((await orderWebhook(base, body, sign(body))).status).toBe(200)
  expect(orderQueue.added).toHaveLength(1)

  const run = processors.get("shopify-order-sync")!
  await run({ name: "orders/create", data: orderQueue.added[0]!.data })
  expect(medusa.orders.filter((o) => !o.isDraft)).toHaveLength(1)
  expect(medusa.orders[0]!.metadata.shopify_order_id).toBe(ORDER_GID)
  expect(medusa.createDraftOrder).toHaveBeenCalledTimes(1)
  expect(medusa.createDraftOrder.mock.calls[0]![0]).toMatchObject({
    sales_channel_id: "sc_shopify",
    items: [{ variant_id: "variant_1", quantity: 2 }],
  })

  // the finished job was released, so a redelivery enqueues a NEW job...
  orderQueue.added.length = 0
  await orderWebhook(base, body, sign(body))
  expect(orderQueue.added).toHaveLength(1)
  // ...which the sync_job claim turns into a no-op
  await run({ name: "orders/create", data: orderQueue.added[0]!.data })
  expect(medusa.createDraftOrder).toHaveBeenCalledTimes(1)
  expect(medusa.orders.filter((o) => !o.isDraft)).toHaveLength(1)
  expect(shopify.calls.orderFetches).toBe(1)
})

test("a forged webhook is rejected with 401 and nothing is enqueued or changed", async () => {
  const { base, queues, medusa } = await boot()
  const body = JSON.stringify({ id: 1001, admin_graphql_api_id: ORDER_GID })

  expect((await orderWebhook(base, body, sign(body, "wrong-secret"))).status).toBe(401)
  expect((await orderWebhook(base, body, "")).status).toBe(401)
  for (const q of queues.values()) expect(q.added.filter((a) => !a.opts?.repeat)).toHaveLength(0)
  expect(medusa.orders).toHaveLength(0)
  expect(medusa.createDraftOrder).not.toHaveBeenCalled()
})

test("a Medusa inventory-level event sets the available quantity on Shopify once", async () => {
  const { base, queues, processors, shopify, amazonInventory, db } = await boot()

  expect((await medusaEvent(base, "inventory-level.updated", "ilev_1")).status).toBe(200)
  const inventoryQueue = queues.get("shopify-inventory-sync")!
  expect(inventoryQueue.added.filter((a) => a.name === "inventory-level.updated")).toHaveLength(1)
  expect(amazonInventory.added).toHaveLength(1) // Amazon fan-out is unchanged

  await processors.get("shopify-inventory-sync")!({
    name: "inventory-level.updated",
    data: { inventoryLevelId: "ilev_1" },
  })
  expect(shopify.calls.setQuantities).toHaveLength(1)
  expect(shopify.calls.setQuantities[0].input).toMatchObject({
    name: "available",
    quantities: [
      { inventoryItemId: "gid://shopify/InventoryItem/1", locationId: LOCATION, quantity: 7 },
    ],
  })
  expect(db.listings[0]!.last_synced_quantity).toBe(7)
})

test("a Medusa price event updates the Shopify variant price once", async () => {
  const { base, queues, processors, shopify, amazonPrice, db } = await boot()

  expect((await medusaEvent(base, "product-variant.updated", "variant_1")).status).toBe(200)
  const priceQueue = queues.get("shopify-price-sync")!
  expect(priceQueue.added).toHaveLength(1)
  expect(amazonPrice.added).toHaveLength(1)

  await processors.get("shopify-price-sync")!({
    name: "product-variant.updated",
    data: priceQueue.added[0]!.data,
  })
  expect(shopify.calls.priceUpdates).toHaveLength(1)
  expect(shopify.calls.priceUpdates[0]).toMatchObject({
    productId: "gid://shopify/Product/1",
    variants: [{ id: "gid://shopify/ProductVariant/1", price: "12.50" }],
  })
  expect(db.listings[0]!.last_synced_price).toBe(12.5)
})

test("the Shopify reconcile is scheduled on the Shopify inventory queue only and routed by job name", async () => {
  const { queues, processors, shopify, medusa } = await boot()
  const inventoryQueue = queues.get("shopify-inventory-sync")!

  const repeatable = inventoryQueue.added.filter((a) => a.opts?.repeat)
  expect(repeatable.map((a) => a.name)).toEqual(["reconcile-shopify"])
  // order and price queues carry no schedule
  expect(queues.get("shopify-order-sync")!.added).toHaveLength(0)
  expect(queues.get("shopify-price-sync")!.added).toHaveLength(0)
  expect([...queues.keys()].sort()).toEqual([
    "shopify-inventory-sync",
    "shopify-order-sync",
    "shopify-price-sync",
    "shopify-tracking-sync",
  ])

  // reconcile job: runs the drift check (stock changed -> corrective push job)
  await processors.get("shopify-inventory-sync")!({ name: "inventory-level.updated", data: { inventoryLevelId: "ilev_1" } })
  medusa.setQuantity(3)
  await processors.get("shopify-inventory-sync")!({ name: "reconcile-shopify", data: {} })
  expect(shopify.calls.setQuantities).toHaveLength(1) // reconcile only requeues
  expect(inventoryQueue.added.filter((a) => a.name === "reconcile")).toEqual([
    { name: "reconcile", data: { channelListingId: "cl-1" }, opts: undefined },
  ])

  // the corrective job is a plain push job
  await processors.get("shopify-inventory-sync")!({ name: "reconcile", data: { channelListingId: "cl-1" } })
  expect(shopify.calls.setQuantities).toHaveLength(2)
  expect(shopify.calls.setQuantities[1].input.quantities[0].quantity).toBe(3)
})

test("with Shopify unconfigured nothing Shopify is started", async () => {
  const h = await harness()
  const createQueue = vi.fn()
  const createWorker = vi.fn()
  const log = vi.spyOn(console, "log").mockImplementation(() => {})

  expect(loadShopifyConfig({} as NodeJS.ProcessEnv)).toBeNull()
  const runtime = await startShopifyIfConfigured(loadShopifyConfig({} as NodeJS.ProcessEnv), {
    ...h.deps,
    createQueue: createQueue as never,
    createWorker: createWorker as never,
  })

  expect(runtime).toBeNull()
  expect(createQueue).not.toHaveBeenCalled()
  expect(createWorker).not.toHaveBeenCalled()
  expect(h.queues.size).toBe(0)
  expect(log.mock.calls.filter((c) => String(c[0]).includes("Shopify"))).toHaveLength(1)
})

test("a Shopify startup failure is isolated: logged once, null returned, Amazon webhook server still works", async () => {
  const h = await harness()
  const err = vi.spyOn(console, "error").mockImplementation(() => {})
  const failingPool = {
    query: async () => {
      throw new Error("column \"shop_domain\" does not exist")
    },
  } as unknown as Pool

  const runtime = await startShopifyIfConfigured(config, { ...h.deps, pool: failingPool })

  expect(runtime).toBeNull()
  expect(err).toHaveBeenCalledTimes(1)
  const logged = JSON.stringify(err.mock.calls[0])
  expect(logged).toContain("Shopify startup failed, continuing without Shopify:")
  expect(logged).not.toContain(config.accessToken)
  expect(logged).not.toContain(config.webhookSecret)

  // main() then builds the webhook server without Shopify deps
  const amazonInventory = new FakeQueue("inventory-sync")
  const amazonPrice = new FakeQueue("price-sync")
  server = createWebhookServer({
    inventoryQueue: amazonInventory as never,
    priceQueue: amazonPrice as never,
    ...(runtime ? { shopify: (runtime as ShopifyRuntime).webhook } : {}),
  })
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()))
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`
  expect((await medusaEvent(base, "inventory-level.updated", "ilev_1")).status).toBe(200)
  expect(amazonInventory.added).toHaveLength(1)
  const body = JSON.stringify({ id: 1 })
  expect((await orderWebhook(base, body, sign(body))).status).toBe(404)
})

beforeEach(() => {
  vi.restoreAllMocks()
})
