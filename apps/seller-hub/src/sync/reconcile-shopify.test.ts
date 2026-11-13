import { expect, test, vi } from "vitest"
import type { Pool } from "pg"
import type { Queue } from "bullmq"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import { reconcileShopify } from "./reconcile.js"

type Listing = {
  id: string
  medusa_variant_id: string
  price_rule: { type: "percentage" | "fixed"; value: number } | null
  last_synced_quantity: number | null
  last_synced_price: string | null
}

const listing = (over: Partial<Listing> & { id: string }): Listing => ({
  medusa_variant_id: "var_" + over.id,
  price_rule: null,
  last_synced_quantity: null,
  last_synced_price: null,
  ...over,
})

const setup = (opts: {
  listings: Listing[]
  lastSyncedAt?: Date | null
  stock?: Record<string, number | Error>
  price?: Record<string, { amount: number; currencyCode: string } | Error>
  orders?: { shopifyOrderId: string }[] | Error
}) => {
  const updates: unknown[][] = []
  const pool = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (/FROM seller_hub\.channel_listing/.test(sql)) return { rows: opts.listings }
      if (/FROM seller_hub\.integration_account/.test(sql))
        return { rows: [{ last_synced_at: opts.lastSyncedAt ?? null }] }
      if (/UPDATE seller_hub\.integration_account/.test(sql)) {
        updates.push(params ?? [])
        return { rows: [] }
      }
      throw new Error("unexpected sql " + sql)
    }),
  } as unknown as Pool
  const unexpected = vi.fn()
  const medusaClient = {
    getVariantInventory: vi.fn(async (id: string) => {
      const v = opts.stock?.[id]
      if (v instanceof Error) throw v
      return { quantity: v ?? 0 }
    }),
    getVariantPricing: vi.fn(async (id: string) => {
      const v = opts.price?.[id]
      if (v instanceof Error) throw v
      return v ?? { amount: 10, currencyCode: "usd" }
    }),
    setVariantInventory: unexpected,
    updateVariantPrice: unexpected,
    createOrder: unexpected,
  } as unknown as MedusaAdminClient
  const inventoryQueue = { add: vi.fn() } as unknown as Queue
  const priceQueue = { add: vi.fn() } as unknown as Queue
  const orderQueue = { add: vi.fn() } as unknown as Queue
  const fetchOrdersSince = vi.fn(async (_since: string) => {
    if (opts.orders instanceof Error) throw opts.orders
    return opts.orders ?? []
  })
  const run = () =>
    reconcileShopify({
      pool,
      medusaClient,
      integrationAccountId: "acct",
      inventoryQueue,
      priceQueue,
      orderQueue,
      fetchOrdersSince,
    })
  return { run, updates, unexpected, inventoryQueue, priceQueue, orderQueue, fetchOrdersSince, medusaClient }
}

test("quantity drift requeues exactly one inventory job", async () => {
  const s = setup({
    listings: [listing({ id: "L1", last_synced_quantity: 5 })],
    stock: { var_L1: 9 },
  })
  const r = await s.run()
  expect(r).toMatchObject({ inventoryRequeued: 1, priceRequeued: 0, ordersRequeued: 0 })
  expect(s.inventoryQueue.add).toHaveBeenCalledTimes(1)
  expect(s.inventoryQueue.add).toHaveBeenCalledWith("reconcile", { channelListingId: "L1" })
  expect(s.priceQueue.add).not.toHaveBeenCalled()
})

test("clamped quantity (negative / fractional) is not permanent drift", async () => {
  const s = setup({
    listings: [
      listing({ id: "L1", last_synced_quantity: 0 }),
      listing({ id: "L2", last_synced_quantity: 3 }),
    ],
    stock: { var_L1: -4, var_L2: 3.7 },
  })
  const r = await s.run()
  expect(r.inventoryRequeued).toBe(0)
})

test("price drift requeues exactly one price job", async () => {
  const s = setup({
    listings: [listing({ id: "L1", last_synced_price: "10.00" })],
    price: { var_L1: { amount: 12, currencyCode: "usd" } },
  })
  const r = await s.run()
  expect(r.priceRequeued).toBe(1)
  expect(s.priceQueue.add).toHaveBeenCalledWith("reconcile", { channelListingId: "L1" })
  expect(s.inventoryQueue.add).not.toHaveBeenCalled()
})

test("price_rule is applied before comparing, so a marked-up listing does not loop", async () => {
  const s = setup({
    listings: [
      listing({
        id: "L1",
        last_synced_price: "11",
        price_rule: { type: "percentage", value: 10 },
      }),
    ],
    price: { var_L1: { amount: 10, currencyCode: "usd" } },
  })
  const r = await s.run()
  expect(r.priceRequeued).toBe(0)
  expect(s.priceQueue.add).not.toHaveBeenCalled()
})

test("no drift requeues nothing, and a listing with no baseline is skipped", async () => {
  const s = setup({
    listings: [
      listing({ id: "L1", last_synced_quantity: 4, last_synced_price: "10" }),
      listing({ id: "L2" }),
    ],
    stock: { var_L1: 4, var_L2: 99 },
  })
  const r = await s.run()
  expect(r).toMatchObject({ inventoryRequeued: 0, priceRequeued: 0 })
  expect(s.medusaClient.getVariantInventory).not.toHaveBeenCalledWith("var_L2")
})

test("two consecutive runs with no changes enqueue nothing the second time", async () => {
  const s = setup({
    listings: [
      listing({
        id: "L1",
        last_synced_quantity: 4,
        last_synced_price: "11",
        price_rule: { type: "percentage", value: 10 },
      }),
    ],
    stock: { var_L1: 4 },
    price: { var_L1: { amount: 10, currencyCode: "usd" } },
  })
  await s.run()
  await s.run()
  expect(s.inventoryQueue.add).not.toHaveBeenCalled()
  expect(s.priceQueue.add).not.toHaveBeenCalled()
})

test("a missed order is enqueued with the webhook job shape and id", async () => {
  const s = setup({
    listings: [],
    orders: [{ shopifyOrderId: "gid://shopify/Order/123" }],
  })
  const r = await s.run()
  expect(r.ordersRequeued).toBe(1)
  expect(s.orderQueue.add).toHaveBeenCalledWith(
    "reconcile",
    { shopifyOrderId: "gid://shopify/Order/123" },
    { jobId: "shopify-order-123", removeOnComplete: true, removeOnFail: true }
  )
})

test("an already-imported order is still enqueued under the same job id so it collapses", async () => {
  const s = setup({
    listings: [],
    orders: [
      { shopifyOrderId: "gid://shopify/Order/123" },
      { shopifyOrderId: "gid://shopify/Order/123" },
    ],
  })
  await s.run()
  const ids = (s.orderQueue.add as ReturnType<typeof vi.fn>).mock.calls.map(
    (c) => (c[2] as { jobId: string }).jobId
  )
  expect(ids).toEqual(["shopify-order-123", "shopify-order-123"])
})

test("orders are fetched since last_synced_at, or 24h back when null", async () => {
  const since = new Date("2026-11-01T00:00:00.000Z")
  const a = setup({ listings: [], lastSyncedAt: since })
  await a.run()
  expect(a.fetchOrdersSince).toHaveBeenCalledWith(since.toISOString())

  const b = setup({ listings: [], lastSyncedAt: null })
  const before = Date.now()
  await b.run()
  const arg = Date.parse(b.fetchOrdersSince.mock.calls[0]![0])
  expect(arg).toBeGreaterThanOrEqual(before - 24 * 3600_000 - 1000)
  expect(arg).toBeLessThanOrEqual(Date.now() - 24 * 3600_000 + 1000)
})

test("a failing listing is isolated and last_synced_at does not advance", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    const s = setup({
      listings: [
        listing({ id: "BAD", last_synced_quantity: 1 }),
        listing({ id: "GOOD", last_synced_quantity: 1 }),
      ],
      stock: { var_BAD: new Error("boom"), var_GOOD: 7 },
      orders: [{ shopifyOrderId: "gid://shopify/Order/9" }],
    })
    const r = await s.run()
    expect(r.inventoryRequeued).toBe(1)
    expect(r.ordersRequeued).toBe(1)
    expect(s.inventoryQueue.add).toHaveBeenCalledWith("reconcile", { channelListingId: "GOOD" })
    expect(s.updates).toHaveLength(0)
  } finally {
    err.mockRestore()
  }
})

test("an order fetch failure does not throw and last_synced_at does not advance", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    const s = setup({ listings: [], orders: new Error("shopify down") })
    const r = await s.run()
    expect(r.ordersRequeued).toBe(0)
    expect(s.updates).toHaveLength(0)
  } finally {
    err.mockRestore()
  }
})

test("a clean scan advances last_synced_at", async () => {
  const s = setup({ listings: [] })
  await s.run()
  expect(s.updates).toHaveLength(1)
  expect(s.updates[0]).toContain("acct")
})

test("never calls Medusa write methods", async () => {
  const s = setup({
    listings: [listing({ id: "L1", last_synced_quantity: 1, last_synced_price: "1" })],
    stock: { var_L1: 5 },
    orders: [{ shopifyOrderId: "gid://shopify/Order/1" }],
  })
  await s.run()
  expect(s.unexpected).not.toHaveBeenCalled()
})
