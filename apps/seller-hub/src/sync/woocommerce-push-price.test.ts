import { expect, test, vi } from "vitest"
import type { Pool } from "pg"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import type { WooCommerceClient } from "../woocommerce/client.js"
import { PermanentSyncError } from "../queue/queues.js"
import { pushWooPrice } from "./woocommerce-push-price.js"

type Listing = {
  id: string
  integration_account_id: string
  medusa_variant_id: string
  external_variant_id: string | null
  external_parent_id: string | null
  price_rule: { type: "percentage" | "fixed"; value: number } | null
  last_synced_price: number | null
}

const ACCOUNT = "acct-1"

const setup = (listing: Partial<Listing> | null = {}, failLastSynced = false) => {
  const row: Listing | null = listing
    ? {
        id: "cl-1",
        integration_account_id: ACCOUNT,
        medusa_variant_id: "variant_1",
        external_variant_id: "5",
        external_parent_id: null,
        price_rule: null,
        last_synced_price: null,
        ...listing,
      }
    : null
  const job = { status: "new", last_error: null as string | null, external_id: "" }
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      if (/INSERT INTO seller_hub\.sync_job/i.test(sql)) {
        expect(sql).toMatch(/'price'/)
        job.status = "processing"
        job.external_id = params[1] as string
        return { rows: [{ id: "job-1" }] }
      }
      if (/FROM seller_hub\.channel_listing/i.test(sql)) {
        const [id, acct] = params
        return {
          rows: row && row.id === id && row.integration_account_id === acct ? [row] : [],
        }
      }
      if (/SET status = 'succeeded'/.test(sql)) {
        job.status = "succeeded"
        job.last_error = null
        return { rowCount: 1 }
      }
      if (/SET status = 'failed'/.test(sql)) {
        job.status = "failed"
        job.last_error = params[0] as string
        return { rowCount: 1 }
      }
      if (/SET last_synced_price/.test(sql)) {
        if (failLastSynced) throw new Error("db down")
        row!.last_synced_price = params[0] as number
        return { rowCount: 1 }
      }
      throw new Error(`unexpected sql: ${sql}`)
    },
  }
  return { pool: pool as unknown as Pool, row, job }
}

const medusa = (amount: number, currencyCode = "usd") =>
  ({
    getVariantPricing: vi.fn().mockResolvedValue({ amount, currencyCode }),
  }) as unknown as MedusaAdminClient

type FakeWoo = WooCommerceClient & { request: ReturnType<typeof vi.fn> }

const woo = (impl?: () => Promise<unknown>): FakeWoo =>
  ({
    request: vi.fn(impl ?? (async () => ({}))),
  }) as unknown as FakeWoo

const run = (
  s: ReturnType<typeof setup>,
  m: MedusaAdminClient,
  c: WooCommerceClient,
  account = ACCOUNT
) =>
  pushWooPrice({
    pool: s.pool,
    medusaClient: m,
    wooClient: c,
    integrationAccountId: account,
    channelListingId: "cl-1",
  })

const sentBody = (c: FakeWoo) => c.request.mock.calls[0]![2].body

test("pushes the price as a 2-decimal USD string and records last_synced_price", async () => {
  const s = setup()
  const c = woo()
  await run(s, medusa(29.9), c)
  expect(c.request).toHaveBeenCalledWith("PUT", "/products/5", {
    body: { regular_price: "29.90" },
  })
  expect(s.job.status).toBe("succeeded")
  expect(s.job.external_id).toBe("cl-1")
  expect(s.row!.last_synced_price).toBe(29.9)
})

test("applies the listing's price_rule before pushing", async () => {
  const s = setup({ price_rule: { type: "percentage", value: 10 } })
  const c = woo()
  await run(s, medusa(29.99), c)
  expect(sentBody(c).regular_price).toBe("32.99")
  expect(s.row!.last_synced_price).toBe(32.99)
})

test("a non-USD Medusa price is a permanent failure and nothing is pushed", async () => {
  const s = setup()
  const c = woo()
  await expect(run(s, medusa(20, "eur"), c)).rejects.toBeInstanceOf(PermanentSyncError)
  expect(c.request).not.toHaveBeenCalled()
  expect(s.job.status).toBe("failed")
  expect(s.job.last_error).toMatch(/eur/i)
  expect(s.row!.last_synced_price).toBeNull()
})

test("a non-finite or negative price is a permanent failure and nothing is pushed", async () => {
  for (const bad of [Number.NaN, -1]) {
    const s = setup()
    const c = woo()
    await expect(run(s, medusa(bad), c)).rejects.toBeInstanceOf(PermanentSyncError)
    expect(c.request).not.toHaveBeenCalled()
  }
})

test("a Woo 4xx becomes PermanentSyncError, records last_error, leaves last_synced_price", async () => {
  const s = setup()
  const c = woo(async () => {
    throw new Error("Woo request failed with status 422")
  })
  await expect(run(s, medusa(10), c)).rejects.toBeInstanceOf(PermanentSyncError)
  expect(s.job.status).toBe("failed")
  expect(s.job.last_error).toContain("422")
  expect(s.row!.last_synced_price).toBeNull()
})

test("a Woo 5xx is rethrown unchanged (retryable)", async () => {
  const s = setup()
  const c = woo(async () => {
    throw new Error("Woo request failed with status 502")
  })
  const p = run(s, medusa(10), c)
  await expect(p).rejects.toThrow(/502/)
  await expect(p).rejects.not.toBeInstanceOf(PermanentSyncError)
  expect(s.row!.last_synced_price).toBeNull()
})

test("a listing belonging to another account is a permanent failure and nothing is pushed", async () => {
  const s = setup({ integration_account_id: "other" })
  const c = woo()
  await expect(run(s, medusa(10), c)).rejects.toBeInstanceOf(PermanentSyncError)
  expect(c.request).not.toHaveBeenCalled()
})

test("a variation price goes to the parent's variations endpoint", async () => {
  const s = setup({ external_variant_id: "21", external_parent_id: "20" })
  const c = woo()
  await run(s, medusa(12.5), c)
  expect(c.request).toHaveBeenCalledWith("PUT", "/products/20/variations/21", {
    body: { regular_price: "12.50" },
  })
})

test("a non-numeric WooCommerce id is a permanent failure", async () => {
  const s = setup({ external_variant_id: "abc" })
  const c = woo()
  await expect(run(s, medusa(10), c)).rejects.toBeInstanceOf(PermanentSyncError)
  expect(c.request).not.toHaveBeenCalled()
})

test("a listing without a WooCommerce id is a permanent failure", async () => {
  const s = setup({ external_variant_id: null })
  const c = woo()
  await expect(run(s, medusa(10), c)).rejects.toBeInstanceOf(PermanentSyncError)
  expect(c.request).not.toHaveBeenCalled()
})

test("keeps the job succeeded if recording last_synced_price fails", async () => {
  const s = setup({}, true)
  const c = woo()
  const spy = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    await run(s, medusa(10), c)
    expect(spy).toHaveBeenCalledTimes(1)
  } finally {
    spy.mockRestore()
  }
  expect(s.job.status).toBe("succeeded")
})
