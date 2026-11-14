import type { AddressInfo } from "node:net"
import type http from "node:http"
import type { Redis as IORedis } from "ioredis"
import type { Pool } from "pg"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { MedusaAdminClient } from "../../medusa/admin-client.js"
import { startShopify, type ShopifyRuntime } from "../../shopify/bootstrap.js"
import { startWooCommerce, type WooCommerceRuntime } from "../../woocommerce/bootstrap.js"
import { createWebhookServer, type WebhookRegistry } from "../../webhook/server.js"
import type { TrackingOrder } from "./types.js"

// In-process end to end for `shipment.created`: the real webhook server, the
// real Shopify / WooCommerce bootstraps (real tracking processor and push),
// fake Shopify and WooCommerce HTTP (fetch fakes), a fake Medusa client and an
// in-memory pool that understands the tracking sync_job rows.
//
// No real BullMQ/Redis: the fake createQueue records `add`s (collapsing a
// still-queued repeated jobId like BullMQ does) and the fake createWorker
// captures each queue's processor. `drain` runs the queued jobs through the
// processor the real worker would call; a failed job stays queued, so calling
// `drain` again is the BullMQ retry of the same job.

const TRACKING = "9400111899223344556677"
const A = "shop-a"
const B = "shop-b"
const W = "woo-1"
const HOST: Record<string, string> = { [A]: "a.myshopify.com", [B]: "b.myshopify.com" }
const WOO_HOST = "woo.example.com"

// ---- fake queues / workers --------------------------------------------------

type Added = { name: string; data: any; opts?: any; done: boolean }
class FakeQueue {
  added: Added[] = []
  constructor(readonly name: string) {}
  async add(name: string, data: any, opts?: any) {
    if (opts?.jobId && this.added.some((a) => a.opts?.jobId === opts.jobId && !a.done)) return {}
    this.added.push({ name, data, opts, done: false })
    return {}
  }
  async removeRepeatable() {}
  async close() {}
}
let queues: FakeQueue[]
let processors: Map<string, (job: { name: string; data: any }) => Promise<void>>
const fakeCreateQueue = ((name: string) => {
  const q = new FakeQueue(name)
  queues.push(q)
  return q
}) as never
const fakeCreateWorker = ((name: string, _c: unknown, fn: any) => {
  processors.set(name, fn)
  return { close: async () => {} }
}) as never
const trackingQueues = () => queues.filter((q) => q.name.includes("-tracking-sync"))

/** Runs every not-yet-settled tracking job once; returns the errors thrown (none = all settled). */
const drain = async (): Promise<Error[]> => {
  const errors: Error[] = []
  for (const q of trackingQueues()) {
    for (const job of q.added.filter((a) => !a.done)) {
      try {
        await processors.get(q.name)!({ name: job.name, data: job.data })
        job.done = true
      } catch (err) {
        errors.push(err as Error) // BullMQ would retry this job
      }
    }
  }
  return errors
}
const tracked = () => trackingQueues().flatMap((q) => q.added)

// ---- fake pool (sync_job tracking rows only) --------------------------------

type SyncJob = { id: string; acct: string; ext: string; status: string; attempts: number; err: string | null }
let jobs: SyncJob[]
const pool = {
  query: async (sql: string, p: any[] = []) => {
    if (/INSERT INTO seller_hub\.sync_job/.test(sql) && /'tracking'/.test(sql)) {
      if (jobs.some((j) => j.acct === p[0] && j.ext === p[1])) return { rows: [], rowCount: 0 }
      const j = { id: `sj-${jobs.length + 1}`, acct: p[0], ext: p[1], status: "processing", attempts: 1, err: null }
      jobs.push(j)
      return { rows: [{ id: j.id, attempts: 1 }], rowCount: 1 }
    }
    if (/SET status = 'processing', attempts = attempts \+ 1/.test(sql) && /'tracking'/.test(sql)) {
      const j = jobs.find((x) => x.acct === p[0] && x.ext === p[1])
      if (j && (j.status === "failed" || j.status === "pending")) {
        j.status = "processing"
        j.attempts += 1
        return { rows: [{ id: j.id, attempts: j.attempts }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    }
    if (/SELECT status,/.test(sql) && /'tracking'/.test(sql)) {
      const j = jobs.find((x) => x.acct === p[0] && x.ext === p[1])
      return { rows: j ? [{ status: j.status, lease_expires_at: Date.now() + 60_000 }] : [] }
    }
    if (/SET status = 'succeeded'/.test(sql)) {
      const j = jobs.find((x) => x.id === p[1])
      const ok = !!j && j.status === "processing" && j.attempts === p[2]
      if (ok) {
        j!.status = "succeeded"
        j!.err = null
      }
      return { rows: [], rowCount: ok ? 1 : 0 }
    }
    if (/SET status = 'failed'/.test(sql)) {
      const j = jobs.find((x) => x.id === p[1])
      const ok = !!j && j.status === "processing" && j.attempts === p[2]
      if (ok) {
        j!.status = "failed"
        j!.err = p[0]
      }
      return { rows: [], rowCount: ok ? 1 : 0 }
    }
    return { rows: [], rowCount: 0 }
  },
} as unknown as Pool

// ---- fake channels -----------------------------------------------------------

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } })

type Outbound = { host: string; kind: string }
let outbound: Outbound[]

type FakeShop = {
  fulfillments: { trackingInfo: { number: string }[] }[]
  fo: { id: string; status: string; lineItems: { nodes: { id: string; sku: string; remainingQuantity: number }[] } }
}
let shops: Record<string, FakeShop>
let failNextCreate: number

const freshShop = (): FakeShop => ({
  fulfillments: [],
  fo: {
    id: "gid://shopify/FulfillmentOrder/1",
    status: "OPEN",
    lineItems: { nodes: [{ id: "gid://shopify/FulfillmentOrderLineItem/1", sku: "SKU-1", remainingQuantity: 1 }] },
  },
})

const shopifyFetch = (async (url: string, init: RequestInit) => {
  const host = new URL(url).host
  const shopId = Object.keys(HOST).find((k) => HOST[k] === host)!
  const { query, variables } = JSON.parse(String(init.body)) as { query: string; variables: any }
  const shop = shops[shopId]!
  if (query.includes("TrackingFulfillmentOrders")) {
    outbound.push({ host, kind: "lookup" })
    return json({
      data: {
        order: {
          fulfillments: shop.fulfillments,
          fulfillmentOrders: {
            pageInfo: { hasNextPage: false },
            nodes: [{ ...shop.fo, lineItems: { pageInfo: { hasNextPage: false }, ...shop.fo.lineItems } }],
          },
        },
      },
    })
  }
  if (query.includes("TrackingFulfillmentCreate")) {
    outbound.push({ host, kind: "fulfillmentCreate" })
    if (failNextCreate > 0) {
      failNextCreate -= 1
      return new Response("unavailable", { status: 503 })
    }
    shop.fulfillments.push({ trackingInfo: [{ number: variables.fulfillment.trackingInfo.number }] })
    shop.fo.status = "CLOSED"
    shop.fo.lineItems.nodes.forEach((l) => (l.remainingQuantity = 0))
    return json({ data: { fulfillmentCreate: { fulfillment: { id: "gid://shopify/Fulfillment/1" }, userErrors: [] } } })
  }
  outbound.push({ host, kind: "link" })
  return json({ data: { productVariants: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } })
}) as unknown as typeof fetch

type FakeWoo = { status: string; notes: { note: string; customer_note: boolean }[] }
let woo: FakeWoo
const wooFetch = (async (url: string, init: RequestInit) => {
  const u = new URL(url)
  const method = init.method ?? "GET"
  const path = u.pathname.replace("/wp-json/wc/v3", "")
  if (path === "/orders/101" && method === "GET") {
    outbound.push({ host: u.host, kind: "getOrder" })
    return json({ id: 101, status: woo.status })
  }
  if (path === "/orders/101/notes" && method === "GET") {
    outbound.push({ host: u.host, kind: "getNotes" })
    return json(woo.notes, 200, { "X-WP-TotalPages": "1" })
  }
  if (path === "/orders/101/notes" && method === "POST") {
    outbound.push({ host: u.host, kind: "addNote" })
    woo.notes.push(JSON.parse(String(init.body)))
    return json({ id: woo.notes.length })
  }
  if (path === "/orders/101" && method === "PUT") {
    outbound.push({ host: u.host, kind: "complete" })
    woo.status = JSON.parse(String(init.body)).status
    return json({ id: 101, status: woo.status })
  }
  outbound.push({ host: u.host, kind: "link" })
  return json([], 200, { "X-WP-TotalPages": "1" })
}) as unknown as typeof fetch

// ---- fake Medusa --------------------------------------------------------------

const fulfillment = (
  over: Partial<TrackingOrder["fulfillments"][number]> = {}
): TrackingOrder["fulfillments"][number] => ({
  id: "ful_1",
  canceledAt: null,
  items: [{ lineItemId: "li_1", quantity: 1 }],
  labels: [{ trackingNumber: TRACKING, trackingUrl: null }],
  carrier: "UPS",
  ...over,
})
const medusaOrder = (metadata: Record<string, unknown>, f = fulfillment()): TrackingOrder => ({
  id: "order_1",
  metadata,
  items: [{ id: "li_1", sku: "SKU-1", quantity: 1 }],
  fulfillments: [f],
})
let medusaOrders: Record<string, TrackingOrder | null>
const getOrderForTracking = vi.fn(async (id: string) => medusaOrders[id] ?? null)
const medusaClient = {
  getOrderForTracking,
  listVariantsBySku: async () => [],
  findSalesChannelIdByName: async () => null,
} as unknown as MedusaAdminClient

// ---- harness -------------------------------------------------------------------

let server: http.Server | undefined
let base = ""
let runtimes: (ShopifyRuntime | WooCommerceRuntime)[] = []
let logged: string[]

const boot = async () => {
  const common = {
    pool,
    medusaClient,
    encryptionKey: "ab".repeat(32),
    redisConnection: {} as IORedis,
    reconcileIntervalMs: 60_000,
    createQueue: fakeCreateQueue,
    createWorker: fakeCreateWorker,
    sleep: async () => {},
  }
  const shopify = (id: string) =>
    startShopify({
      ...common,
      config: { shopDomain: HOST[id]!, accessToken: "shpat_secret_token", webhookSecret: "wh", locationId: "1" },
      accountId: id,
      fetchImpl: shopifyFetch,
    })
  const ra = await shopify(A)
  const rb = await shopify(B)
  const rw = await startWooCommerce({
    ...common,
    config: { siteUrl: `https://${WOO_HOST}`, consumerKey: "ck_key", consumerSecret: "cs_secret", webhookSecret: "wh" },
    accountId: W,
    fetchImpl: wooFetch,
  })
  runtimes = [ra, rb, rw]
  const registry: WebhookRegistry = {
    get: (m, id) => (m === "shopify" ? (id === B ? rb : ra) : rw).webhook,
    all: (m) => (m === "shopify" ? [ra.webhook, rb.webhook] : [rw.webhook]),
  }
  server = createWebhookServer({
    inventoryQueue: new FakeQueue("inventory-sync") as never,
    priceQueue: new FakeQueue("price-sync") as never,
    connectors: registry,
  })
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  await Promise.all(runtimes.map((r) => r.linked))
  outbound = [] // ignore boot-time SKU link traffic
}

const shipmentCreated = async (data: Record<string, unknown> = {}) => {
  const res = await fetch(`${base}/webhooks/medusa`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event: "shipment.created", data: { id: "ful_1", order_id: "order_1", ...data } }),
  })
  await res.text()
  return res.status
}

beforeEach(() => {
  queues = []
  processors = new Map()
  jobs = []
  outbound = []
  shops = { [A]: freshShop(), [B]: freshShop() }
  woo = { status: "processing", notes: [] }
  failNextCreate = 0
  medusaOrders = {}
  getOrderForTracking.mockClear()
  logged = []
  for (const k of ["log", "error", "warn", "info"] as const) {
    vi.spyOn(console, k).mockImplementation((...a: unknown[]) => {
      logged.push(a.map(String).join(" "))
    })
  }
})
afterEach(async () => {
  const output = logged.join("\n")
  vi.restoreAllMocks()
  if (server) {
    const s = server
    server = undefined
    s.closeAllConnections?.()
    await new Promise((r) => s.close(r))
  }
  for (const r of runtimes) await r.stop()
  runtimes = []
  expect(output).not.toContain(TRACKING)
  expect(output).not.toContain("shpat_secret_token")
})

const shopifyOwned = (account: string) => ({ shopify_account_id: account, shopify_order_id: "5001" })

test("(a) a shipment for a connection A order pushes to A only", async () => {
  await boot()
  medusaOrders["order_1"] = medusaOrder(shopifyOwned(A))

  expect(await shipmentCreated()).toBe(200)
  expect(tracked()).toHaveLength(3) // every live connection receives the event
  expect(await drain()).toEqual([])

  expect(outbound.filter((o) => o.kind === "fulfillmentCreate")).toEqual([
    { host: HOST[A], kind: "fulfillmentCreate" },
  ])
  expect(outbound.some((o) => o.host === HOST[B])).toBe(false)
  expect(outbound.some((o) => o.host === WOO_HOST)).toBe(false)
  expect(shops[A]!.fulfillments).toHaveLength(1)
  expect(shops[B]!.fulfillments).toHaveLength(0)
  expect(jobs.map((j) => j.status)).toEqual(["succeeded", "succeeded", "succeeded"])
})

test("(b) replaying the webhook does not push twice", async () => {
  await boot()
  medusaOrders["order_1"] = medusaOrder(shopifyOwned(A))

  await shipmentCreated()
  await drain()
  expect(await shipmentCreated()).toBe(200)
  expect(await drain()).toEqual([])

  expect(outbound.filter((o) => o.kind === "fulfillmentCreate")).toHaveLength(1)
  expect(shops[A]!.fulfillments).toHaveLength(1)
  expect(jobs).toHaveLength(3) // the replayed jobs hit the existing succeeded rows
})

test("(c) a WooCommerce-owned order adds one note and completes the order on Woo only", async () => {
  await boot()
  medusaOrders["order_1"] = medusaOrder({ woocommerce_account_id: W, woocommerce_order_id: "101" })

  expect(await shipmentCreated()).toBe(200)
  expect(await drain()).toEqual([])

  expect(outbound.every((o) => o.host === WOO_HOST)).toBe(true)
  expect(outbound.filter((o) => o.kind === "addNote")).toHaveLength(1)
  expect(outbound.filter((o) => o.kind === "complete")).toHaveLength(1)
  expect(woo.notes).toHaveLength(1)
  expect(woo.notes[0]!.note).toContain(`Tracking number: ${TRACKING}`)
  expect(woo.status).toBe("completed")
  expect(shops[A]!.fulfillments).toHaveLength(0)
  expect(shops[B]!.fulfillments).toHaveLength(0)
})

test("(d) a manual order (no account metadata) is skipped everywhere with no outbound calls", async () => {
  await boot()
  medusaOrders["order_1"] = medusaOrder({})

  expect(await shipmentCreated()).toBe(200)
  expect(await drain()).toEqual([])

  expect(outbound).toEqual([])
  expect(jobs.map((j) => j.status)).toEqual(["succeeded", "succeeded", "succeeded"])
})

test("(e) a transient 503 retries and succeeds without a duplicate fulfilment", async () => {
  await boot()
  medusaOrders["order_1"] = medusaOrder(shopifyOwned(A))
  failNextCreate = 1

  await shipmentCreated()
  // First run: A's job fails (BullMQ would retry the same job).
  const first = await drain()
  expect(first).toHaveLength(1)
  expect(first[0]!.message).not.toContain(TRACKING)
  expect(first[0]!.name).not.toBe("PermanentSyncError")
  expect(shops[A]!.fulfillments).toHaveLength(0)
  expect(jobs.find((j) => j.acct === A)!.status).toBe("failed")

  // Retry: the failed row is reclaimed (attempt 2) and the push succeeds.
  expect(await drain()).toEqual([])
  expect(shops[A]!.fulfillments).toHaveLength(1)
  expect(jobs.find((j) => j.acct === A)!).toMatchObject({ status: "succeeded", attempts: 2 })

  // A replay afterwards is a no-op: still exactly one fulfilment.
  await shipmentCreated()
  await drain()
  expect(shops[A]!.fulfillments).toHaveLength(1)
  expect(outbound.filter((o) => o.kind === "fulfillmentCreate")).toHaveLength(2) // the 503 + the real one
})

test("(f) an amazon-owned order pushes nothing and returns 200", async () => {
  await boot()
  medusaOrders["order_1"] = medusaOrder({ amazon_account_id: "amz-1", amazon_order_id: "114-1" })

  expect(await shipmentCreated()).toBe(200)
  // Only Shopify/WooCommerce connections receive the event; no Amazon tracking queue exists.
  expect(queues.some((q) => q.name.toLowerCase().includes("amazon"))).toBe(false)
  expect(await drain()).toEqual([])
  expect(outbound).toEqual([])
  expect(getOrderForTracking).toHaveBeenCalled() // read to decide, never pushed
})

test("(g) a cancelled fulfillment or one without a tracking number pushes nothing", async () => {
  await boot()
  medusaOrders["order_1"] = medusaOrder(shopifyOwned(A), fulfillment({ canceledAt: "2026-11-15T00:00:00Z" }))
  expect(await shipmentCreated()).toBe(200)
  expect(await drain()).toEqual([])
  expect(outbound).toEqual([])

  medusaOrders["order_2"] = medusaOrder(shopifyOwned(A), fulfillment({ id: "ful_2", labels: [] }))
  expect(await shipmentCreated({ id: "ful_2", order_id: "order_2" })).toBe(200)
  expect(await drain()).toEqual([])
  expect(outbound).toEqual([])
})
