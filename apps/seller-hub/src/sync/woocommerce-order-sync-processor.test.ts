import { beforeEach, expect, test, vi } from "vitest"
import type { Pool } from "pg"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import { DeferSyncError, PermanentSyncError } from "../queue/queues.js"
import type { NormalizedWooOrder } from "../woocommerce/orders.js"
import {
  processWooOrderSyncJob,
  type WooOrderSyncProcessorDeps,
} from "./woocommerce-order-sync-processor.js"
import { PENDING_RECHECK_MS } from "./shopify-import-order.js"

const ACCOUNT = "acct-woo"
const CHANNEL = "sc_wordpress"
// The numeric WooCommerce order id, as a string (the queue job's value).
const OID = "100"

// ---- in-memory stand-ins (no database, no Medusa) -------------------------

type Job = {
  id: string
  external_id: string
  status: string
  attempts: number
  last_error: string | null
  medusa_entity_id: string | null
  updated_at: number
}
type FakeOrder = {
  id: string
  isDraft: boolean
  metadata: Record<string, unknown>
}

let jobs: Job[]
let orders: FakeOrder[]
let links: Map<string, string>
let now: number
let nextId: number

const fakePool = {
  query: async (sql: string, params: unknown[] = []) => {
    const find = (id: unknown) => jobs.find((j) => j.id === id)
    if (/INSERT INTO seller_hub\.sync_job/.test(sql)) {
      const externalId = params[1] as string
      if (jobs.some((j) => j.external_id === externalId)) return { rows: [] }
      const job: Job = {
        id: `job-${++nextId}`,
        external_id: externalId,
        status: "processing",
        attempts: 1,
        last_error: null,
        medusa_entity_id: null,
        updated_at: now,
      }
      jobs.push(job)
      return { rows: [job] }
    }
    if (/SET status = 'processing', attempts = attempts \+ 1/.test(sql)) {
      const externalId = params[1] as string
      const stale = params[2] as number
      const job = jobs.find((j) => j.external_id === externalId)
      if (
        job &&
        (["failed", "pending"].includes(job.status) ||
          (job.status === "processing" && job.updated_at < now - stale))
      ) {
        job.status = "processing"
        job.attempts += 1
        job.updated_at = now
        return { rows: [job] }
      }
      return { rows: [] }
    }
    if (/SELECT status, medusa_entity_id,/.test(sql)) {
      const externalId = params[1] as string
      const stale = params[2] as number
      const job = jobs.find((j) => j.external_id === externalId)
      return {
        rows: job ? [{ ...job, lease_expires_at: job.updated_at + stale }] : [],
      }
    }
    if (/SET updated_at = now\(\)/.test(sql)) {
      const job = find(params[0])
      const ok = job?.status === "processing" && job.attempts === params[1]
      if (ok) job!.updated_at = now
      return { rowCount: ok ? 1 : 0 }
    }
    if (/SET medusa_entity_id = \$1, updated_at/.test(sql)) {
      const job = find(params[1])
      const ok = job?.status === "processing" && job.attempts === params[2]
      if (ok) job!.medusa_entity_id = params[0] as string
      return { rowCount: ok ? 1 : 0 }
    }
    if (/SET status = 'succeeded'/.test(sql)) {
      const job = find(params[1])
      const ok = job?.status === "processing" && job.attempts === params[2]
      if (ok) {
        job!.status = "succeeded"
        job!.medusa_entity_id = params[0] as string | null
        job!.last_error = null
      }
      return { rowCount: ok ? 1 : 0 }
    }
    if (/SET status = 'failed'/.test(sql)) {
      const job = find(params[1])
      const ok = job?.status === "processing" && job.attempts === params[2]
      if (ok) {
        job!.status = "failed"
        job!.last_error = params[0] as string
      }
      return { rowCount: ok ? 1 : 0 }
    }
    if (/FROM seller_hub\.channel_listing/.test(sql)) {
      const acct = params[0] as string
      const skus = params[1] as string[]
      return {
        rows:
          acct === ACCOUNT
            ? skus
                .filter((s) => links.has(s))
                .map((s) => ({
                  external_sku: s,
                  medusa_variant_id: links.get(s),
                }))
            : [],
      }
    }
    throw new Error(`unexpected sql: ${sql}`)
  },
} as unknown as Pool

const makeMedusa = (
  opts: { createError?: Error; convertError?: Error } = {}
) => {
  const client = {
    findOrderByMetadata: vi.fn(async (key: string, value: string) => {
      const m = orders.find((o) => !o.isDraft && o.metadata[key] === value)
      return m ? { id: m.id } : null
    }),
    getOrderById: vi.fn(async (id: string) => {
      const o = orders.find((x) => x.id === id)
      return o ? { id: o.id, isDraftOrder: o.isDraft } : null
    }),
    createDraftOrder: vi.fn(async (input: any) => {
      if (opts.createError) throw opts.createError
      await Promise.resolve() // yield so concurrent callers interleave
      const o = {
        id: `order_${++nextId}`,
        isDraft: true,
        metadata: input.metadata,
      }
      orders.push(o)
      return { id: o.id }
    }),
    convertDraftOrderToOrder: vi.fn(async (id: string) => {
      if (opts.convertError) throw opts.convertError
      orders.find((o) => o.id === id)!.isDraft = false
      return { id }
    }),
  }
  return client as typeof client & MedusaAdminClient
}

const wooOrder = (over: Partial<NormalizedWooOrder> = {}): NormalizedWooOrder => ({
  wooOrderId: OID,
  status: "processing",
  currencyCode: "USD",
  buyerEmail: "b@example.com",
  items: [{ sku: "SKU-1", quantity: 2, unitPrice: 8.5 }],
  shippingAddress: {
    first_name: "Ann",
    last_name: "Lee",
    address_1: "1 Main",
    city: "Reno",
    country_code: "US",
    postal_code: "89501",
  },
  ...over,
})

const deps = (
  medusa: ReturnType<typeof makeMedusa>,
  over: Partial<WooOrderSyncProcessorDeps> = {}
): WooOrderSyncProcessorDeps => ({
  pool: fakePool,
  medusaClient: medusa,
  integrationAccountId: ACCOUNT,
  resolveSalesChannelId: async () => CHANNEL,
  fetchOrder: async () => wooOrder(),
  ...over,
})

const realOrders = () => orders.filter((o) => !o.isDraft)

const seedJob = (over: Partial<Job>) =>
  jobs.push({
    id: "job-x",
    external_id: OID,
    status: "failed",
    attempts: 1,
    last_error: null,
    medusa_entity_id: null,
    updated_at: now,
    ...over,
  })

const run = (medusa: ReturnType<typeof makeMedusa>, d = deps(medusa)) =>
  processWooOrderSyncJob({ wooOrderId: OID }, d)

beforeEach(() => {
  jobs = []
  orders = []
  links = new Map([["SKU-1", "variant_1"]])
  now = 1_000_000
  nextId = 0
})

// ---- tests ---------------------------------------------------------------

test("a processing order creates one order in the WordPress channel with Woo prices", async () => {
  const medusa = makeMedusa()
  const result = await run(medusa)

  expect(result.status).toBe("created")
  expect(realOrders()).toHaveLength(1)
  expect(realOrders()[0]!.metadata).toMatchObject({ woocommerce_order_id: OID })
  expect(medusa.createDraftOrder).toHaveBeenCalledWith({
    sales_channel_id: CHANNEL,
    email: "b@example.com",
    items: [{ variant_id: "variant_1", quantity: 2, unit_price: 8.5 }],
    shipping_address: wooOrder().shippingAddress,
    metadata: { woocommerce_order_id: OID },
  })
  expect(jobs).toHaveLength(1)
  expect(jobs[0]).toMatchObject({
    status: "succeeded",
    external_id: OID,
    medusa_entity_id: result.medusaOrderId,
  })
})

test("a completed order is importable", async () => {
  const medusa = makeMedusa()
  const r = await run(
    medusa,
    deps(medusa, { fetchOrder: async () => wooOrder({ status: "completed" }) })
  )
  expect(r.status).toBe("created")
})

test("importing the same order twice sequentially yields one order", async () => {
  const medusa = makeMedusa()
  const first = await run(medusa)
  const second = await run(medusa)

  expect(second.status).toBe("skipped")
  expect(second.medusaOrderId).toBe(first.medusaOrderId)
  expect(realOrders()).toHaveLength(1)
  expect(medusa.createDraftOrder).toHaveBeenCalledTimes(1)
})

test("a concurrent second claim yields one order and defers the loser", async () => {
  const medusa = makeMedusa()
  const settled = await Promise.allSettled([run(medusa), run(medusa)])

  expect(settled.filter((o) => o.status === "fulfilled")).toHaveLength(1)
  const loser = settled.find(
    (o) => o.status === "rejected"
  ) as PromiseRejectedResult
  expect(loser.reason).toBeInstanceOf(DeferSyncError)
  expect(orders).toHaveLength(1)
  expect(realOrders()).toHaveLength(1)
})

test("a failed row whose order already exists in Medusa is recovered, not duplicated", async () => {
  seedJob({ last_error: "network blip after convert" })
  orders.push({
    id: "order_existing",
    isDraft: false,
    metadata: { woocommerce_order_id: OID },
  })
  const medusa = makeMedusa()

  const result = await run(medusa)

  expect(result).toEqual({ status: "recovered", medusaOrderId: "order_existing" })
  expect(medusa.createDraftOrder).not.toHaveBeenCalled()
  expect(orders).toHaveLength(1)
  expect(jobs[0]).toMatchObject({
    status: "succeeded",
    medusa_entity_id: "order_existing",
  })
})

test("a persisted draft from a previous attempt is converted, never re-created", async () => {
  seedJob({ last_error: "convert timed out", medusa_entity_id: "draft_1" })
  orders.push({
    id: "draft_1",
    isDraft: true,
    metadata: { woocommerce_order_id: OID },
  })
  const medusa = makeMedusa()

  const result = await run(medusa)

  expect(result).toEqual({ status: "created", medusaOrderId: "draft_1" })
  expect(medusa.createDraftOrder).not.toHaveBeenCalled()
  expect(orders).toHaveLength(1)
})

test("a stale processing claim is reclaimed and the order still imports once", async () => {
  seedJob({ status: "processing", updated_at: now - 10_000 })
  const medusa = makeMedusa()
  const result = await run(medusa, deps(medusa, { staleProcessingMs: 5_000 }))
  expect(result.status).toBe("created")
  expect(realOrders()).toHaveLength(1)
})

test("cancelled, refunded and trash orders are skipped and settled", async () => {
  for (const status of ["cancelled", "refunded", "trash"]) {
    const medusa = makeMedusa()
    const result = await processWooOrderSyncJob(
      { wooOrderId: `skip-${status}` },
      deps(medusa, { fetchOrder: async () => wooOrder({ status }) })
    )
    expect(result.status).toBe("skipped")
    expect(medusa.createDraftOrder).not.toHaveBeenCalled()
    expect(jobs.find((j) => j.external_id === `skip-${status}`)!.status).toBe(
      "succeeded"
    )
  }
  expect(orders).toHaveLength(0)
})

test("pending, on-hold and failed orders are deferred, then a processing one imports", async () => {
  for (const held of ["pending", "on-hold", "failed"]) {
    jobs = []
    orders = []
    const medusa = makeMedusa()
    let status = held
    const d = deps(medusa, { fetchOrder: async () => wooOrder({ status }) })

    const before = Date.now()
    const err = await run(medusa, d).catch((e) => e)
    expect(err).toBeInstanceOf(DeferSyncError)
    expect(err.retryAt).toBeGreaterThanOrEqual(before + PENDING_RECHECK_MS)
    expect(orders).toHaveLength(0)
    expect(jobs[0]!.status).toBe("failed")

    status = "processing"
    const result = await run(medusa, d)
    expect(result.status).toBe("created")
    expect(realOrders()).toHaveLength(1)
    expect(jobs[0]!.status).toBe("succeeded")
  }
})

test("an unknown status fails permanently with nothing created", async () => {
  const medusa = makeMedusa()
  const err = await run(
    medusa,
    deps(medusa, { fetchOrder: async () => wooOrder({ status: "weird" }) })
  ).catch((e) => e)
  expect(err).toBeInstanceOf(PermanentSyncError)
  expect(medusa.createDraftOrder).not.toHaveBeenCalled()
  expect(jobs[0]!.status).toBe("failed")
})

test("an unlinked SKU fails permanently with no draft or order created", async () => {
  const medusa = makeMedusa()
  const err = await run(
    medusa,
    deps(medusa, {
      fetchOrder: async () =>
        wooOrder({
          items: [
            { sku: "SKU-1", quantity: 1, unitPrice: 1 },
            { sku: "NO-LINK", quantity: 1, unitPrice: 2 },
          ],
        }),
    })
  ).catch((e) => e)

  expect(err).toBeInstanceOf(PermanentSyncError)
  expect(err.message).toContain("NO-LINK")
  expect(medusa.createDraftOrder).not.toHaveBeenCalled()
  expect(orders).toHaveLength(0)
  expect(jobs[0]).toMatchObject({ status: "failed" })
  expect(jobs[0]!.last_error).toContain("NO-LINK")
})

test("a line with a blank SKU fails permanently with no draft or order", async () => {
  // Even if a blank external_sku somehow existed as a link, it must not match.
  links.set("", "variant_blank")
  const medusa = makeMedusa()
  const err = await run(
    medusa,
    deps(medusa, {
      fetchOrder: async () =>
        wooOrder({ items: [{ sku: "", quantity: 1, unitPrice: 1 }] }),
    })
  ).catch((e) => e)
  expect(err).toBeInstanceOf(PermanentSyncError)
  expect(medusa.createDraftOrder).not.toHaveBeenCalled()
  expect(orders).toHaveLength(0)
  expect(jobs[0]!.status).toBe("failed")
  expect(jobs[0]!.last_error).toBeTruthy()
})

test("a non-USD order fails permanently without creating anything", async () => {
  const medusa = makeMedusa()
  const err = await run(
    medusa,
    deps(medusa, { fetchOrder: async () => wooOrder({ currencyCode: "CAD" }) })
  ).catch((e) => e)
  expect(err).toBeInstanceOf(PermanentSyncError)
  expect(err.message).toContain("CAD")
  expect(medusa.createDraftOrder).not.toHaveBeenCalled()
  expect(jobs[0]!.status).toBe("failed")
})

test("a missing WordPress sales channel is a retryable plain error", async () => {
  const medusa = makeMedusa()
  const fetchOrder = vi.fn(async () => wooOrder())
  const err = await run(
    medusa,
    deps(medusa, { resolveSalesChannelId: async () => null, fetchOrder })
  ).catch((e) => e)

  expect(err).toBeInstanceOf(Error)
  expect(err).not.toBeInstanceOf(PermanentSyncError)
  expect(err).not.toBeInstanceOf(DeferSyncError)
  expect(err.message).toMatch(/WordPress sales channel/)
  expect(fetchOrder).not.toHaveBeenCalled()
  expect(jobs[0]!.status).toBe("failed")
})

test("a Medusa 4xx is permanent, a 5xx is retryable", async () => {
  const permanent = await processWooOrderSyncJob(
    { wooOrderId: "4xx" },
    deps(
      makeMedusa({
        createError: new Error("POST /admin/draft-orders failed with status 400"),
      })
    )
  ).catch((e) => e)
  expect(permanent).toBeInstanceOf(PermanentSyncError)

  const transient = await processWooOrderSyncJob(
    { wooOrderId: "5xx" },
    deps(
      makeMedusa({
        createError: new Error("POST /admin/draft-orders failed with status 503"),
      })
    )
  ).catch((e) => e)
  expect(transient).toBeInstanceOf(Error)
  expect(transient).not.toBeInstanceOf(PermanentSyncError)
  expect(orders).toHaveLength(0)
})

test("a failed order is deferred with no draft, then the SAME id imports once it is processing", async () => {
  const medusa = makeMedusa()
  let status = "failed"
  const d = deps(medusa, { fetchOrder: async () => wooOrder({ status }) })

  const err = await run(medusa, d).catch((e) => e)
  expect(err).toBeInstanceOf(DeferSyncError)
  expect(medusa.createDraftOrder).not.toHaveBeenCalled()
  expect(orders).toHaveLength(0)
  expect(jobs[0]!.status).toBe("failed")

  status = "processing"
  const result = await run(medusa, d)
  expect(result.status).toBe("created")
  expect(realOrders()).toHaveLength(1)
  expect(jobs).toHaveLength(1)
  expect(jobs[0]!.status).toBe("succeeded")
  expect(medusa.createDraftOrder).toHaveBeenCalledTimes(1)
})
