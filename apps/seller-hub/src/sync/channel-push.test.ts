import type { Pool } from "pg"
import { beforeEach, expect, test, vi } from "vitest"
import { PermanentSyncError } from "../queue/queues.js"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import { processChannelPushJob, type ChannelPushListing } from "./channel-push.js"

const ACCOUNT = "acct-1"

const LISTING: ChannelPushListing = {
  id: "cl-1",
  medusa_variant_id: "variant_1",
  external_sku: "SKU1",
  external_variant_id: "gid://v/5",
  external_inventory_item_id: "gid://i/5",
  external_parent_id: null,
  price_rule: null,
}

const makePool = () => {
  const jobs: Record<string, { status: string; last_error: string | null }> = {}
  const synced: { qty?: number; price?: number } = {}
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      if (/INSERT INTO seller_hub\.sync_job/i.test(sql)) {
        const type = /'inventory'/.test(sql) ? "inventory" : "price"
        jobs[type] = { status: "processing", last_error: null }
        return { rows: [{ id: `job-${type}` }] }
      }
      if (/SET status = 'succeeded'/.test(sql)) {
        jobs[String(params[1]).replace("job-", "")]!.status = "succeeded"
        return { rowCount: 1 }
      }
      if (/SET status = 'failed'/.test(sql)) {
        const id = String(params[1]).replace("job-", "")
        jobs[id]!.status = "failed"
        jobs[id]!.last_error = params[0] as string
        return { rowCount: 1 }
      }
      if (/SET last_synced_quantity/.test(sql)) {
        synced.qty = params[0] as number
        return { rowCount: 1 }
      }
      if (/SET last_synced_price/.test(sql)) {
        synced.price = params[0] as number
        return { rowCount: 1 }
      }
      throw new Error(`unexpected sql: ${sql}`)
    },
  }
  return { pool: pool as unknown as Pool, jobs, synced }
}

const setup = (
  opts: {
    listing?: Partial<ChannelPushListing> | null
    values?: { price: number | null; effective_price: number; stock: number }
    pushStock?: (l: ChannelPushListing, n: number) => Promise<void>
    pushPrice?: (l: ChannelPushListing, n: number) => Promise<void>
  } = {}
) => {
  const p = makePool()
  const medusaClient = {
    getChannelPushValues: vi.fn(async () => opts.values ?? { price: 12, effective_price: 20, stock: 7 }),
    reportChannelSyncResult: vi.fn(async (..._a: unknown[]) => {}),
    getVariantInventory: vi.fn(async () => ({ quantity: 999 })),
  }
  const pushStock = vi.fn(opts.pushStock ?? (async () => {}))
  const pushPrice = vi.fn(opts.pushPrice ?? (async () => {}))
  const listing = opts.listing === null ? null : { ...LISTING, ...opts.listing }
  const findListing = vi.fn(async () => listing)
  const deps = {
    pool: p.pool,
    medusaClient: medusaClient as unknown as MedusaAdminClient,
    integrationAccountId: ACCOUNT,
    pushStock,
    pushPrice,
    findListing,
  }
  return { ...p, medusaClient, pushStock, pushPrice, findListing, deps }
}

const job = (kind: "stock" | "price" | "both", force = false) => ({
  variantId: "variant_1",
  salesChannelId: "sc_1",
  kind,
  force,
})

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

test("pushes the channel's own stock (not the variant total) and reports synced", async () => {
  const s = setup()
  await processChannelPushJob(job("stock"), s.deps)
  expect(s.medusaClient.getChannelPushValues).toHaveBeenCalledWith("variant_1", "sc_1")
  expect(s.medusaClient.getVariantInventory).not.toHaveBeenCalled()
  expect(s.pushStock).toHaveBeenCalledWith(expect.objectContaining({ id: "cl-1" }), 7)
  expect(s.pushPrice).not.toHaveBeenCalled()
  expect(s.synced.qty).toBe(7)
  expect(s.jobs.inventory!.status).toBe("succeeded")
  expect(s.medusaClient.reportChannelSyncResult).toHaveBeenCalledWith("variant_1", "sc_1", {
    state: "synced",
    stock: 7,
  })
})

test("price push applies the price_rule to the effective price", async () => {
  const s = setup({ listing: { price_rule: { type: "percentage", value: 10 } } })
  await processChannelPushJob(job("price", true), s.deps)
  expect(s.pushPrice).toHaveBeenCalledWith(expect.objectContaining({ id: "cl-1" }), 22)
  expect(s.pushStock).not.toHaveBeenCalled()
  expect(s.synced.price).toBe(22)
  expect(s.medusaClient.reportChannelSyncResult).toHaveBeenCalledWith("variant_1", "sc_1", {
    state: "synced",
    price: 22,
  })
})

test("both pushes stock and price and reports both", async () => {
  const s = setup()
  await processChannelPushJob(job("both"), s.deps)
  expect(s.pushStock).toHaveBeenCalledTimes(1)
  expect(s.pushPrice).toHaveBeenCalledWith(expect.anything(), 20)
  expect(s.medusaClient.reportChannelSyncResult).toHaveBeenCalledWith("variant_1", "sc_1", {
    state: "synced",
    price: 20,
    stock: 7,
  })
})

test("stock is clamped to a non-negative integer", async () => {
  const s = setup({ values: { price: null, effective_price: 5, stock: -3.7 } })
  await processChannelPushJob(job("stock"), s.deps)
  expect(s.pushStock).toHaveBeenCalledWith(expect.anything(), 0)
  const s2 = setup({ values: { price: null, effective_price: 5, stock: 4.9 } })
  await processChannelPushJob(job("stock"), s2.deps)
  expect(s2.pushStock).toHaveBeenCalledWith(expect.anything(), 4)
})

test("no listing reports failed 'not listed' and never throws or pushes", async () => {
  const s = setup({ listing: null })
  await expect(processChannelPushJob(job("both"), s.deps)).resolves.toBeUndefined()
  expect(s.medusaClient.reportChannelSyncResult).toHaveBeenCalledWith("variant_1", "sc_1", {
    state: "failed",
    error: "not listed",
  })
  expect(s.medusaClient.getChannelPushValues).not.toHaveBeenCalled()
  expect(s.pushStock).not.toHaveBeenCalled()
})

test("a permanent failure is reported failed, recorded, and not rethrown", async () => {
  const s = setup({
    pushPrice: async () => {
      throw new PermanentSyncError("only USD is supported")
    },
  })
  await expect(processChannelPushJob(job("price", true), s.deps)).resolves.toBeUndefined()
  expect(s.jobs.price!.status).toBe("failed")
  expect(s.jobs.price!.last_error).toBe("only USD is supported")
  expect(s.medusaClient.reportChannelSyncResult).toHaveBeenCalledWith("variant_1", "sc_1", {
    state: "failed",
    error: "only USD is supported",
  })
  expect(s.synced.price).toBeUndefined()
})

test("a 4xx (not 429) from the marketplace is permanent", async () => {
  const s = setup({
    pushStock: async () => {
      throw new Error("Shopify request failed with status 422")
    },
  })
  await expect(processChannelPushJob(job("stock"), s.deps)).resolves.toBeUndefined()
  expect(s.medusaClient.reportChannelSyncResult).toHaveBeenCalledWith(
    "variant_1",
    "sc_1",
    expect.objectContaining({ state: "failed" })
  )
})

test("a transient failure is rethrown, recorded failed, and never reported synced", async () => {
  const s = setup({
    pushStock: async () => {
      throw new Error("Shopify request failed with status 429")
    },
  })
  await expect(processChannelPushJob(job("stock"), s.deps)).rejects.toThrow("429")
  expect(s.jobs.inventory!.status).toBe("failed")
  expect(s.medusaClient.reportChannelSyncResult).not.toHaveBeenCalled()
  expect(s.synced.qty).toBeUndefined()
})

test("a failing report after a successful push does not fail the job", async () => {
  const s = setup()
  s.medusaClient.reportChannelSyncResult.mockRejectedValue(new Error("backend down"))
  await expect(processChannelPushJob(job("stock"), s.deps)).resolves.toBeUndefined()
  expect(s.jobs.inventory!.status).toBe("succeeded")
})

test("logs never include secrets from the values or the pool", async () => {
  const s = setup()
  const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "error")]
  await processChannelPushJob(job("both"), s.deps)
  for (const l of logs) {
    const out = JSON.stringify(l.mock.calls)
    expect(out).not.toMatch(/token|secret|password/i)
  }
})

const transient = () => {
  throw new Error("Shopify request failed with status 503")
}

test("a non-final transient failure rethrows without reporting", async () => {
  const s = setup({ pushStock: transient as never })
  await expect(processChannelPushJob(job("stock"), { ...s.deps, finalAttempt: false })).rejects.toThrow("503")
  expect(s.medusaClient.reportChannelSyncResult).not.toHaveBeenCalled()
})

test("a final-attempt transient failure reports failed, then rethrows", async () => {
  const s = setup({ pushStock: transient as never })
  await expect(processChannelPushJob(job("stock"), { ...s.deps, finalAttempt: true })).rejects.toThrow("503")
  expect(s.medusaClient.reportChannelSyncResult).toHaveBeenCalledWith("variant_1", "sc_1", {
    state: "failed",
    error: "Marketplace unreachable; will retry on next change",
  })
  expect(s.medusaClient.reportChannelSyncResult).not.toHaveBeenCalledWith(
    expect.anything(), expect.anything(), expect.objectContaining({ state: "synced" })
  )
})

test("a failing report on the final attempt does not mask the original error", async () => {
  const s = setup({ pushStock: transient as never })
  s.medusaClient.reportChannelSyncResult.mockRejectedValue(new Error("backend down"))
  await expect(processChannelPushJob(job("stock"), { ...s.deps, finalAttempt: true })).rejects.toThrow("503")
})

test.each([
  ["missing stock", { price: null, effective_price: 5 }],
  ["NaN stock", { price: null, effective_price: 5, stock: Number.NaN }],
  ["string stock", { price: null, effective_price: 5, stock: "7" }],
  ["null effective price", { price: null, effective_price: null, stock: 7 }],
  ["string effective price", { price: null, effective_price: "5", stock: 7 }],
])("a malformed push-values response (%s) is a permanent failure and pushes nothing", async (_n, values) => {
  const s = setup({ values: values as any })
  await expect(processChannelPushJob(job("both"), s.deps)).resolves.toBeUndefined()
  expect(s.pushStock).not.toHaveBeenCalled()
  expect(s.pushPrice).not.toHaveBeenCalled()
  expect(s.medusaClient.reportChannelSyncResult).toHaveBeenCalledWith(
    "variant_1",
    "sc_1",
    expect.objectContaining({ state: "failed", error: "unexpected push-values response" })
  )
})
