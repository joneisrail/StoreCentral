import { expect, test, vi } from "vitest"
import type { Pool } from "pg"
import type { Queue } from "bullmq"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import { reconcileWooCommerce, RECONCILE_WOOCOMMERCE_JOB } from "./reconcile-woocommerce.js"
import { pushWooInventory } from "./woocommerce-push-inventory.js"
import { pushWooPrice } from "./woocommerce-push-price.js"
import { setWooStock, setWooPrice } from "../woocommerce/products.js"

vi.mock("./woocommerce-push-inventory.js", () => ({ pushWooInventory: vi.fn() }))
vi.mock("./woocommerce-push-price.js", () => ({ pushWooPrice: vi.fn() }))
vi.mock("../woocommerce/products.js", () => ({ setWooStock: vi.fn(), setWooPrice: vi.fn() }))

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
  orders?: { wooOrderId: string }[] | Error
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
    reconcileWooCommerce({
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
    listings: [listing({ id: "L1", last_synced_quantity: 5, last_synced_price: "10" })],
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
    listings: [listing({ id: "L1", last_synced_quantity: 0, last_synced_price: "10.00" })],
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

test("no drift requeues nothing for a listing that has a baseline", async () => {
  const s = setup({
    listings: [listing({ id: "L1", last_synced_quantity: 4, last_synced_price: "10" })],
    stock: { var_L1: 4 },
  })
  const r = await s.run()
  expect(r).toMatchObject({ inventoryRequeued: 0, priceRequeued: 0 })
})

test("a never-pushed listing (NULL baseline) is enqueued once per run until it is pushed", async () => {
  const s = setup({ listings: [listing({ id: "NEW" })] })
  const r1 = await s.run()
  expect(r1).toMatchObject({ inventoryRequeued: 1, priceRequeued: 1 })
  expect(s.inventoryQueue.add).toHaveBeenCalledWith("reconcile", { channelListingId: "NEW" })
  expect(s.priceQueue.add).toHaveBeenCalledWith("reconcile", { channelListingId: "NEW" })
  // not pushed yet -> still no baseline -> enqueued again, exactly once per run
  await s.run()
  expect(s.inventoryQueue.add).toHaveBeenCalledTimes(2)
  expect(s.priceQueue.add).toHaveBeenCalledTimes(2)
})

test("only the missing baseline is enqueued: NULL quantity -> inventory, NULL price -> price", async () => {
  const s = setup({
    listings: [
      listing({ id: "Q", last_synced_price: "10" }),
      listing({ id: "P", last_synced_quantity: 0 }),
    ],
    stock: { var_P: 0 },
  })
  await s.run()
  expect(s.inventoryQueue.add).toHaveBeenCalledTimes(1)
  expect(s.inventoryQueue.add).toHaveBeenCalledWith("reconcile", { channelListingId: "Q" })
  expect(s.priceQueue.add).toHaveBeenCalledTimes(1)
  expect(s.priceQueue.add).toHaveBeenCalledWith("reconcile", { channelListingId: "P" })
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
    orders: [{ wooOrderId: "123" }],
  })
  const r = await s.run()
  expect(r.ordersRequeued).toBe(1)
  expect(s.orderQueue.add).toHaveBeenCalledWith(
    "reconcile",
    { wooOrderId: "123" },
    { jobId: "woocommerce-order-123", removeOnComplete: true, removeOnFail: true }
  )
})

test("an already-imported order is still enqueued under the same job id so it collapses", async () => {
  const s = setup({
    listings: [],
    orders: [
      { wooOrderId: "123" },
      { wooOrderId: "123" },
    ],
  })
  await s.run()
  const ids = (s.orderQueue.add as ReturnType<typeof vi.fn>).mock.calls.map(
    (c) => (c[2] as { jobId: string }).jobId
  )
  expect(ids).toEqual(["woocommerce-order-123", "woocommerce-order-123"])
})

test("orders are fetched since (last_synced_at minus 15min) or (scan start minus 24h minus 15min when null)", async () => {
  const since = new Date("2026-11-01T00:00:00.000Z")
  const a = setup({ listings: [], lastSyncedAt: since })
  await a.run()
  expect(a.fetchOrdersSince).toHaveBeenCalledWith(new Date(since.getTime() - 15 * 60_000).toISOString())

  const b = setup({ listings: [], lastSyncedAt: null })
  const before = Date.now()
  await b.run()
  const arg = Date.parse(b.fetchOrdersSince.mock.calls[0]![0])
  expect(arg).toBeGreaterThanOrEqual(before - 24 * 3600_000 - 15 * 60_000 - 1000)
  expect(arg).toBeLessThanOrEqual(Date.now() - 24 * 3600_000 - 15 * 60_000 + 1000)
})

test("a failing listing is isolated and last_synced_at still advances when orders were fetched", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    const s = setup({
      listings: [
        listing({ id: "BAD", last_synced_quantity: 1 }),
        listing({ id: "GOOD", last_synced_quantity: 1 }),
      ],
      stock: { var_BAD: new Error("boom"), var_GOOD: 7 },
      orders: [{ wooOrderId: "9" }],
    })
    const r = await s.run()
    expect(r.inventoryRequeued).toBe(1)
    expect(r.ordersRequeued).toBe(1)
    expect(s.inventoryQueue.add).toHaveBeenCalledWith("reconcile", { channelListingId: "GOOD" })
    expect(r.failedChecks).toBe(1)
    expect(s.updates).toHaveLength(1)
  } finally {
    err.mockRestore()
  }
})

test("an order fetch failure does not throw and last_synced_at does not advance", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    const s = setup({ listings: [], orders: new Error("woo down") })
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

test("exports the job name", () => {
  expect(RECONCILE_WOOCOMMERCE_JOB).toBe("reconcile-woocommerce")
})

test("never calls push functions or WooCommerce writes, nor Medusa writes", async () => {
  const s = setup({
    listings: [listing({ id: "L1", last_synced_quantity: 1, last_synced_price: "1" })],
    stock: { var_L1: 5 },
    orders: [{ wooOrderId: "1" }],
  })
  await s.run()
  expect(s.unexpected).not.toHaveBeenCalled()
  expect(pushWooInventory).not.toHaveBeenCalled()
  expect(pushWooPrice).not.toHaveBeenCalled()
  expect(setWooStock).not.toHaveBeenCalled()
  expect(setWooPrice).not.toHaveBeenCalled()
})

test("a rejecting inventoryQueue.add for a NULL baseline is isolated, counted, and the scan completes", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    const s = setup({
      listings: [
        listing({ id: "BAD", last_synced_price: "10" }),
        listing({ id: "GOOD", last_synced_price: "10" }),
      ],
      orders: [{ wooOrderId: "9" }],
    })
    ;(s.inventoryQueue.add as ReturnType<typeof vi.fn>).mockImplementation(async (_n: string, d: { channelListingId: string }) => {
      if (d.channelListingId === "BAD") throw new Error("redis down")
    })
    const r = await s.run()
    expect(r.failedChecks).toBe(1)
    expect(r.inventoryRequeued).toBe(1)
    expect(s.inventoryQueue.add).toHaveBeenCalledWith("reconcile", { channelListingId: "GOOD" })
    expect(r.ordersRequeued).toBe(1)
    expect(s.updates).toHaveLength(1)
  } finally {
    err.mockRestore()
  }
})

test("a rejecting priceQueue.add for a NULL baseline is isolated, counted, and the scan completes", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    const s = setup({
      listings: [
        listing({ id: "BAD", last_synced_quantity: 0 }),
        listing({ id: "GOOD", last_synced_quantity: 0 }),
      ],
      orders: [{ wooOrderId: "9" }],
    })
    ;(s.priceQueue.add as ReturnType<typeof vi.fn>).mockImplementation(async (_n: string, d: { channelListingId: string }) => {
      if (d.channelListingId === "BAD") throw new Error("redis down")
    })
    const r = await s.run()
    expect(r.failedChecks).toBe(1)
    expect(r.priceRequeued).toBe(1)
    expect(s.priceQueue.add).toHaveBeenCalledWith("reconcile", { channelListingId: "GOOD" })
    expect(r.ordersRequeued).toBe(1)
    expect(s.updates).toHaveLength(1)
  } finally {
    err.mockRestore()
  }
})

test("the watermark advances to the scan start, not the overlapped query start", async () => {
  const since = new Date("2026-11-01T00:00:00.000Z")
  const s = setup({ listings: [], lastSyncedAt: since })
  const before = Date.now()
  await s.run()
  const written = (s.updates[0] as unknown[]).find((v) => v instanceof Date) as Date
  expect(written.getTime()).toBeGreaterThanOrEqual(before - 1000)
  expect(written.getTime()).toBeLessThanOrEqual(Date.now() + 1000)
})
