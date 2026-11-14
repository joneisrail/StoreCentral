import type { Pool } from "pg"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { DeferSyncError, PermanentSyncError } from "../../queue/queues.js"
import { processTrackingJob } from "./processor.js"
import type { TrackingOrder } from "./types.js"

const ACCT = "acct-1"
const job = { fulfillmentId: "ful_1", orderId: "order_1", noNotification: false }

type Row = { id: string; status: string; attempts: number; last_error: string | null }

/** Tiny in-memory stand-in for the sync_job table, keyed by SQL shape. */
const makePool = (initial?: Partial<Row>) => {
  let row: Row | null = initial
    ? { id: "sj1", status: "pending", attempts: 0, last_error: null, ...initial }
    : null
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("INSERT INTO seller_hub.sync_job")) {
      if (row) return { rows: [], rowCount: 0 }
      row = { id: "sj1", status: "processing", attempts: 1, last_error: null }
      return { rows: [{ id: row.id, attempts: 1 }], rowCount: 1 }
    }
    if (sql.includes("SET status = 'processing'")) {
      if (row && (row.status === "failed" || row.status === "pending")) {
        row.status = "processing"
        row.attempts += 1
        return { rows: [{ id: row.id, attempts: row.attempts }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    }
    if (sql.startsWith("SELECT status")) {
      return { rows: row ? [{ status: row.status, lease_expires_at: Date.now() + 1000 }] : [], rowCount: 1 }
    }
    if (sql.includes("SET status = 'succeeded'")) {
      row!.status = "succeeded"
      row!.last_error = null
      return { rows: [], rowCount: 1 }
    }
    if (sql.includes("SET status = 'failed'")) {
      row!.status = "failed"
      row!.last_error = params[0] as string
      return { rows: [], rowCount: 1 }
    }
    throw new Error(`unexpected sql ${sql}`)
  })
  return { pool: { query } as unknown as Pool, get row() { return row } }
}

const order = (over: Partial<TrackingOrder> = {}, ful: Partial<TrackingOrder["fulfillments"][0]> = {}): TrackingOrder => ({
  id: "order_1",
  metadata: { shopify_account_id: ACCT, shopify_order_id: "gid://shopify/Order/9" },
  items: [{ id: "li_1", sku: "S", quantity: 1 }],
  fulfillments: [
    {
      id: "ful_1",
      canceledAt: null,
      items: [{ lineItemId: "li_1", quantity: 1 }],
      labels: [{ trackingNumber: "TRACK123", trackingUrl: "https://t.example/TRACK123?token=SECRET" }],
      carrier: "USPS",
      ...ful,
    },
  ],
  ...over,
})

const setup = (o: TrackingOrder | null, initial?: Partial<Row>) => {
  const db = makePool(initial)
  const push = vi.fn(async () => "pushed" as const)
  const medusaClient = { getOrderForTracking: vi.fn(async () => o) }
  const run = () =>
    processTrackingJob(job, {
      pool: db.pool,
      medusaClient,
      integrationAccountId: ACCT,
      marketplace: "shopify",
      push,
    })
  return { db, push, medusaClient, run }
}

let logs: unknown[][]
beforeEach(() => {
  logs = []
  for (const m of ["log", "warn", "error"] as const) {
    vi.spyOn(console, m).mockImplementation((...a) => void logs.push(a))
  }
})
afterEach(() => vi.restoreAllMocks())

test("pushes once and records succeeded", async () => {
  const t = setup(order())
  expect(await t.run()).toEqual({ status: "pushed" })
  expect(t.push).toHaveBeenCalledWith(
    expect.objectContaining({ externalOrderId: "gid://shopify/Order/9", noNotification: false })
  )
  expect(t.db.row?.status).toBe("succeeded")
})

test("second delivery of the same fulfillment is skipped without pushing", async () => {
  const t = setup(order(), { status: "succeeded", attempts: 1 })
  expect(await t.run()).toEqual({ status: "skipped" })
  expect(t.push).not.toHaveBeenCalled()
  expect(t.medusaClient.getOrderForTracking).not.toHaveBeenCalled()
})

test("order of another account (or no target) is skipped and settled", async () => {
  const other = setup(order({ metadata: { shopify_account_id: "other", shopify_order_id: "x" } }))
  expect(await other.run()).toEqual({ status: "skipped" })
  expect(other.push).not.toHaveBeenCalled()
  expect(other.db.row?.status).toBe("succeeded")

  const manual = setup(order({ metadata: {} }))
  expect(await manual.run()).toEqual({ status: "skipped" })
  expect(manual.push).not.toHaveBeenCalled()

  const gone = setup(null)
  expect(await gone.run()).toEqual({ status: "skipped" })
})

test("an order of another marketplace with this account id is skipped", async () => {
  const t = setup(order({ metadata: { woocommerce_account_id: ACCT, woocommerce_order_id: "5" } }))
  expect(await t.run()).toEqual({ status: "skipped" })
  expect(t.push).not.toHaveBeenCalled()
})

test("canceled fulfillment, missing fulfillment or missing tracking number is skipped", async () => {
  for (const o of [
    order({}, { canceledAt: "2026-01-01" }),
    order({}, { labels: [] }),
    order({ fulfillments: [] }),
  ]) {
    const t = setup(o)
    expect(await t.run()).toEqual({ status: "skipped" })
    expect(t.push).not.toHaveBeenCalled()
    expect(t.db.row?.status).toBe("succeeded")
  }
})

test("transient error rethrows and leaves the job retryable", async () => {
  const t = setup(order())
  t.push.mockRejectedValueOnce(new Error("Shopify request failed with status 503: upstream"))
  const err = await t.run().catch((e) => e)
  expect(err).toBeInstanceOf(Error)
  expect(err).not.toBeInstanceOf(PermanentSyncError)
  expect(t.db.row?.status).toBe("failed")

  // The retry reclaims the failed row and succeeds.
  t.push.mockResolvedValueOnce("pushed")
  expect(await t.run()).toEqual({ status: "pushed" })
  expect(t.db.row?.status).toBe("succeeded")
  expect(t.db.row?.attempts).toBe(2)
})

test("permanent error is recorded failed without retry", async () => {
  const t = setup(order())
  t.push.mockRejectedValueOnce(new Error("Shopify request failed with status 422: bad"))
  const err = await t.run().catch((e) => e)
  expect(err).toBeInstanceOf(PermanentSyncError)
  expect(t.db.row?.status).toBe("failed")
  expect(t.db.row?.last_error).toContain("422")

  const t2 = setup(order())
  t2.push.mockRejectedValueOnce(new PermanentSyncError("nope"))
  expect(await t2.run().catch((e) => e)).toBeInstanceOf(PermanentSyncError)
})

test("a live claim held by another attempt defers the job", async () => {
  const t = setup(order(), { status: "processing", attempts: 1 })
  expect(await t.run().catch((e) => e)).toBeInstanceOf(DeferSyncError)
  expect(t.push).not.toHaveBeenCalled()
})

test("no secrets in logs, last_error or the thrown message", async () => {
  const t = setup(order())
  t.push.mockRejectedValueOnce(
    new Error("status 500 for https://u:pw@host/x?token=SECRET tracking TRACK123 Bearer abc")
  )
  const err = await t.run().catch((e) => e)
  const everything = JSON.stringify([logs, t.db.row, err.message])
  for (const s of ["SECRET", "TRACK123", "Bearer", "u:pw", "https://"]) {
    expect(everything).not.toContain(s)
  }
})
