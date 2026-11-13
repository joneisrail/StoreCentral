import crypto from "node:crypto"
import type http from "node:http"
import type { AddressInfo } from "node:net"
import type { Redis as IORedis } from "ioredis"
import type { Pool } from "pg"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import { createWebhookServer } from "../webhook/server.js"
import { loadWooCommerceConfig, type WooCommerceConfig } from "./config.js"
import {
  startWooCommerce,
  startWooCommerceIfConfigured,
  type StartWooCommerceDeps,
  type WooCommerceRuntime,
} from "./bootstrap.js"

// In-process end to end: fake WooCommerce REST (injected fetchImpl), fake
// Medusa admin client, in-memory pool and in-memory queues. The real webhook
// server, the real WooCommerce client and the real link/push/import/reconcile
// code run.

const ENC_KEY = "00".repeat(32)
const SECRET = "whsec_test"
const config: WooCommerceConfig = {
  siteUrl: "https://shop.example.com",
  consumerKey: "ck_test_key",
  consumerSecret: "cs_test_secret",
  webhookSecret: SECRET,
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
  external_parent_id: string | null
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
    if (/FROM seller_hub\.integration_account\s+WHERE marketplace = 'woocommerce'/.test(sql)) {
      return { rows: account ? [{ id: account.id }] : [] }
    }
    if (/INSERT INTO seller_hub\.integration_account/.test(sql)) {
      account = { id: "acct-woo", last_synced_at: null }
      return { rows: [{ id: account.id, shop_domain: p[0] }] }
    }
    if (/UPDATE seller_hub\.integration_account\s+SET shop_domain/.test(sql)) {
      return { rows: [{ id: p[3], shop_domain: p[0] }] }
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
      const [acct, productId, variantId, sku, extId, extParent] = p
      if (listings.some((l) => l.acct === acct && l.external_sku === sku)) {
        return { rowCount: 0, rows: [] }
      }
      listings.push({
        id: `cl-${listings.length + 1}`,
        acct,
        medusa_product_id: productId,
        medusa_variant_id: variantId,
        external_sku: sku,
        external_variant_id: extId,
        external_parent_id: extParent,
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
    if (/SELECT medusa_variant_id, external_variant_id, external_parent_id/.test(sql)) {
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
      { variantId: "variant_2", productId: "prod_2", sku: "SKU-2" },
      { variantId: "variant_3", productId: "prod_3", sku: "ONLY-IN-MEDUSA" },
    ]),
    findSalesChannelIdByName: vi.fn(async (name: string) =>
      name === "WordPress" ? "sc_wordpress" : null
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

// ---- fake WooCommerce REST -------------------------------------------------

const makeWoo = () => {
  const calls = {
    puts: [] as { path: string; body: any }[],
    orderFetches: 0,
    auth: new Set<string>(),
  }
  const json = (data: unknown) =>
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json", "X-WP-TotalPages": "1" },
    })
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const u = new URL(url)
    const method = init.method ?? "GET"
    calls.auth.add(String((init.headers as Record<string, string>).Authorization))
    const path = u.pathname.replace("/wp-json/wc/v3", "")
    if (method === "GET" && path === "/products") {
      return json([
        { id: 10, type: "simple", sku: "SKU-1", regular_price: "10.00" },
        { id: 20, type: "variable", sku: "" },
        { id: 99, type: "simple", sku: "ONLY-IN-WOO", regular_price: "5.00" },
      ])
    }
    if (method === "GET" && path === "/products/20/variations") {
      return json([{ id: 21, sku: "SKU-2", regular_price: "8.00" }])
    }
    if (method === "PUT") {
      calls.puts.push({ path, body: JSON.parse(String(init.body)) })
      return json({})
    }
    if (method === "GET" && path === "/orders/1042") {
      calls.orderFetches++
      return json({
        id: 1042,
        status: "processing",
        currency: "USD",
        billing: { email: "buyer@example.com" },
        shipping: { first_name: "Ann", last_name: "Lee", address_1: "1 Main", city: "Reno", country: "US", postcode: "89501" },
        line_items: [{ sku: "SKU-1", quantity: 2, total: "17.00" }],
      })
    }
    if (method === "GET" && path === "/orders") return json([])
    throw new Error(`unexpected WooCommerce request: ${method} ${url}`)
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
  const woo = makeWoo()
  const queues = new Map<string, FakeQueue>()
  const processors = new Map<string, Processor>()
  const deps: Omit<StartWooCommerceDeps, "config"> = {
    pool: db.pool,
    medusaClient: medusa,
    encryptionKey: ENC_KEY,
    redisConnection: {} as IORedis,
    reconcileIntervalMs: 3_600_000,
    fetchImpl: woo.fetchImpl,
    sleep: async () => {},
    createQueue: ((name: string) => {
      const q = new FakeQueue(name)
      queues.set(name, q)
      return q
    }) as unknown as StartWooCommerceDeps["createQueue"],
    createWorker: ((name: string, _c: unknown, processor: Processor) => {
      processors.set(name, processor)
      return {}
    }) as unknown as StartWooCommerceDeps["createWorker"],
  }
  return { db, medusa, woo, queues, processors, deps }
}

const boot = async () => {
  const h = await harness()
  const runtime = (await startWooCommerce({ ...h.deps, config })) as WooCommerceRuntime
  await runtime.linked
  const amazonInventory = new FakeQueue("inventory-sync")
  const amazonPrice = new FakeQueue("price-sync")
  server = createWebhookServer({
    inventoryQueue: amazonInventory as never,
    priceQueue: amazonPrice as never,
    woocommerce: runtime.webhook,
  })
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()))
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`
  return { ...h, runtime, amazonInventory, amazonPrice, base }
}

const sign = (body: string, secret = SECRET) =>
  crypto.createHmac("sha256", secret).update(body).digest("base64")

const wooWebhook = (
  base: string,
  body: string,
  signature: string,
  topic = "order.created"
) =>
  fetch(`${base}/webhooks/woocommerce`, {
    method: "POST",
    headers: { "X-WC-Webhook-Signature": signature, "X-WC-Webhook-Topic": topic },
    body,
  })

const medusaEvent = (base: string, event: string, id: string) =>
  fetch(`${base}/webhooks/medusa`, {
    method: "POST",
    body: JSON.stringify({ event, data: { id } }),
  })

const ORDER_BODY = JSON.stringify({ id: 1042, status: "processing" })

// ---- tests -----------------------------------------------------------------

test("links WooCommerce listings to StoreCentral variants by SKU (simple product and variation)", async () => {
  const { db, woo } = await boot()
  expect(db.listings).toHaveLength(2)
  expect(db.listings[0]).toMatchObject({
    acct: "acct-woo",
    medusa_variant_id: "variant_1",
    external_sku: "SKU-1",
    external_variant_id: "10",
    external_parent_id: null,
  })
  expect(db.listings[1]).toMatchObject({
    medusa_variant_id: "variant_2",
    external_sku: "SKU-2",
    external_variant_id: "21",
    external_parent_id: "20",
  })
  // a WooCommerce SKU with no StoreCentral match is recorded, not linked
  expect(db.jobs.filter((j) => j.type === "product").map((j) => j.external_id)).toEqual([
    "ONLY-IN-WOO",
  ])
  // the client authenticates with the consumer key/secret over Basic auth
  expect([...woo.calls.auth]).toEqual([
    `Basic ${Buffer.from("ck_test_key:cs_test_secret").toString("base64")}`,
  ])
})

test("a signed order.created webhook imports exactly one order; a duplicate delivery imports none", async () => {
  const { base, queues, processors, medusa, woo } = await boot()

  expect((await wooWebhook(base, ORDER_BODY, sign(ORDER_BODY))).status).toBe(200)
  const orderQueue = queues.get("woocommerce-order-sync")!
  expect(orderQueue.added).toHaveLength(1)
  expect(orderQueue.added[0]!.data).toEqual({ wooOrderId: "1042" })

  // same delivery again while the job is still queued collapses on the job id
  expect((await wooWebhook(base, ORDER_BODY, sign(ORDER_BODY))).status).toBe(200)
  expect(orderQueue.added).toHaveLength(1)

  const run = processors.get("woocommerce-order-sync")!
  await run({ name: "order.created", data: orderQueue.added[0]!.data })
  expect(medusa.orders.filter((o) => !o.isDraft)).toHaveLength(1)
  expect(medusa.orders[0]!.metadata.woocommerce_order_id).toBe("1042")
  expect(medusa.createDraftOrder).toHaveBeenCalledTimes(1)
  expect(medusa.createDraftOrder.mock.calls[0]![0]).toMatchObject({
    sales_channel_id: "sc_wordpress",
    items: [{ variant_id: "variant_1", quantity: 2 }],
  })

  // the finished job was released, so a redelivery enqueues a NEW job...
  orderQueue.added.length = 0
  await wooWebhook(base, ORDER_BODY, sign(ORDER_BODY), "order.updated")
  expect(orderQueue.added).toHaveLength(1)
  // ...which the sync_job claim turns into a no-op
  await run({ name: "order.updated", data: orderQueue.added[0]!.data })
  expect(medusa.createDraftOrder).toHaveBeenCalledTimes(1)
  expect(medusa.orders.filter((o) => !o.isDraft)).toHaveLength(1)
  expect(woo.calls.orderFetches).toBe(1)
})

test("a signed form-encoded creation ping is acknowledged and queues nothing", async () => {
  const { base, queues, medusa } = await boot()
  const ping = "webhook_id=5"

  expect((await wooWebhook(base, ping, sign(ping), "")).status).toBe(200)
  for (const q of queues.values()) expect(q.added.filter((a) => !a.opts?.repeat)).toHaveLength(0)
  expect(medusa.createDraftOrder).not.toHaveBeenCalled()
})

test("a forged webhook is rejected with 401 and nothing is enqueued or changed", async () => {
  const { base, queues, medusa, woo } = await boot()

  expect((await wooWebhook(base, ORDER_BODY, sign(ORDER_BODY, "wrong-secret"))).status).toBe(401)
  expect((await wooWebhook(base, ORDER_BODY, "")).status).toBe(401)
  for (const q of queues.values()) expect(q.added.filter((a) => !a.opts?.repeat)).toHaveLength(0)
  expect(medusa.orders).toHaveLength(0)
  expect(medusa.createDraftOrder).not.toHaveBeenCalled()
  expect(woo.calls.puts).toHaveLength(0)
})

test("a Medusa inventory-level event sets the available quantity on WooCommerce once", async () => {
  const { base, queues, processors, woo, amazonInventory, db } = await boot()

  expect((await medusaEvent(base, "inventory-level.updated", "ilev_1")).status).toBe(200)
  const inventoryQueue = queues.get("woocommerce-inventory-sync")!
  expect(inventoryQueue.added.filter((a) => a.name === "inventory-level.updated")).toHaveLength(1)
  expect(amazonInventory.added).toHaveLength(1) // Amazon fan-out is unchanged

  await processors.get("woocommerce-inventory-sync")!({
    name: "inventory-level.updated",
    data: { inventoryLevelId: "ilev_1" },
  })
  expect(woo.calls.puts).toEqual([
    { path: "/products/10", body: { manage_stock: true, stock_quantity: 7 } },
  ])
  expect(db.listings[0]!.last_synced_quantity).toBe(7)
})

test("a Medusa price event updates the WooCommerce regular_price once", async () => {
  const { base, queues, processors, woo, amazonPrice, db } = await boot()

  expect((await medusaEvent(base, "product-variant.updated", "variant_1")).status).toBe(200)
  const priceQueue = queues.get("woocommerce-price-sync")!
  expect(priceQueue.added).toHaveLength(1)
  expect(amazonPrice.added).toHaveLength(1)

  await processors.get("woocommerce-price-sync")!({
    name: "product-variant.updated",
    data: priceQueue.added[0]!.data,
  })
  expect(woo.calls.puts).toEqual([
    { path: "/products/10", body: { regular_price: "12.50" } },
  ])
  expect(db.listings[0]!.last_synced_price).toBe(12.5)
})

test("the WooCommerce reconcile is scheduled on the WooCommerce inventory queue only and routed by job name", async () => {
  const { queues, processors, woo, medusa } = await boot()
  const inventoryQueue = queues.get("woocommerce-inventory-sync")!

  const repeatable = inventoryQueue.added.filter((a) => a.opts?.repeat)
  expect(repeatable.map((a) => a.name)).toEqual(["reconcile-woocommerce"])
  expect(queues.get("woocommerce-order-sync")!.added).toHaveLength(0)
  expect(queues.get("woocommerce-price-sync")!.added).toHaveLength(0)
  expect([...queues.keys()].sort()).toEqual([
    "woocommerce-inventory-sync",
    "woocommerce-order-sync",
    "woocommerce-price-sync",
  ])

  await processors.get("woocommerce-inventory-sync")!({
    name: "inventory-level.updated",
    data: { inventoryLevelId: "ilev_1" },
  })
  medusa.setQuantity(3)
  await processors.get("woocommerce-inventory-sync")!({ name: "reconcile-woocommerce", data: {} })
  expect(woo.calls.puts).toHaveLength(1) // reconcile only requeues
  expect(inventoryQueue.added.filter((a) => a.data?.channelListingId === "cl-1")).toHaveLength(1)

  // the corrective job is a plain push job
  await processors.get("woocommerce-inventory-sync")!({
    name: "reconcile",
    data: { channelListingId: "cl-1" },
  })
  expect(woo.calls.puts).toHaveLength(2)
  expect(woo.calls.puts[1]!.body.stock_quantity).toBe(3)
})

test("with WooCommerce unconfigured nothing WooCommerce is started", async () => {
  const h = await harness()
  const createQueue = vi.fn()
  const createWorker = vi.fn()
  const log = vi.spyOn(console, "log").mockImplementation(() => {})

  expect(loadWooCommerceConfig({} as NodeJS.ProcessEnv)).toBeNull()
  const runtime = await startWooCommerceIfConfigured(
    loadWooCommerceConfig({} as NodeJS.ProcessEnv),
    { ...h.deps, createQueue: createQueue as never, createWorker: createWorker as never }
  )

  expect(runtime).toBeNull()
  expect(createQueue).not.toHaveBeenCalled()
  expect(createWorker).not.toHaveBeenCalled()
  expect(h.queues.size).toBe(0)
  expect(log.mock.calls.filter((c) => String(c[0]).includes("WooCommerce"))).toHaveLength(1)
})

test("a WooCommerce startup failure is isolated: logged once, null returned, Amazon webhook server still works", async () => {
  const h = await harness()
  const err = vi.spyOn(console, "error").mockImplementation(() => {})
  const failingPool = {
    query: async () => {
      throw new Error("column \"shop_domain\" does not exist")
    },
  } as unknown as Pool

  const runtime = await startWooCommerceIfConfigured(config, { ...h.deps, pool: failingPool })

  expect(runtime).toBeNull()
  expect(err).toHaveBeenCalledTimes(1)
  const logged = JSON.stringify(err.mock.calls[0])
  expect(logged).toContain("WooCommerce startup failed, continuing without WooCommerce:")
  expect(logged).not.toContain(config.consumerKey)
  expect(logged).not.toContain(config.consumerSecret)
  expect(logged).not.toContain(config.webhookSecret)

  // main() then builds the webhook server without WooCommerce deps
  const amazonInventory = new FakeQueue("inventory-sync")
  const amazonPrice = new FakeQueue("price-sync")
  server = createWebhookServer({
    inventoryQueue: amazonInventory as never,
    priceQueue: amazonPrice as never,
    ...(runtime ? { woocommerce: (runtime as WooCommerceRuntime).webhook } : {}),
  })
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()))
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`
  expect((await medusaEvent(base, "inventory-level.updated", "ilev_1")).status).toBe(200)
  expect(amazonInventory.added).toHaveLength(1)
  expect((await wooWebhook(base, ORDER_BODY, sign(ORDER_BODY))).status).toBe(404)
})

beforeEach(() => {
  vi.restoreAllMocks()
})
