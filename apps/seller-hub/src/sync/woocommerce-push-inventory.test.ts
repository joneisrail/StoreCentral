import { expect, test, vi } from "vitest"
import type { Pool } from "pg"
import type { MedusaAdminClient } from "../medusa/admin-client.js"
import type { WooCommerceClient } from "../woocommerce/client.js"
import { PermanentSyncError } from "../queue/queues.js"
import { pushWooInventory } from "./woocommerce-push-inventory.js"

type Listing = {
  id: string
  integration_account_id: string
  medusa_variant_id: string
  external_variant_id: string | null
  external_parent_id: string | null
  last_synced_quantity: number | null
}

const ACCOUNT = "acct-1"

const setup = (listing: Partial<Listing> | null = {}, failLastSynced = false) => {
  const row: Listing | null = listing
    ? {
        id: "cl-1",
        integration_account_id: ACCOUNT,
        medusa_variant_id: "variant_1",
        external_variant_id: "9",
        external_parent_id: null,
        last_synced_quantity: null,
        ...listing,
      }
    : null
  const job = { status: "new", last_error: null as string | null, external_id: "" }
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      if (/INSERT INTO seller_hub\.sync_job/i.test(sql)) {
        expect(sql).toMatch(/'inventory'/)
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
      if (/SET last_synced_quantity/.test(sql)) {
        if (failLastSynced) throw new Error("db down")
        row!.last_synced_quantity = params[0] as number
        return { rowCount: 1 }
      }
      throw new Error(`unexpected sql: ${sql}`)
    },
  }
  return { pool: pool as unknown as Pool, row, job }
}

const medusa = (quantity: number) =>
  ({
    getVariantInventory: vi.fn().mockResolvedValue({ quantity }),
  }) as unknown as MedusaAdminClient & {
    getVariantInventory: ReturnType<typeof vi.fn>
  }

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
  pushWooInventory({
    pool: s.pool,
    medusaClient: m,
    wooClient: c,
    integrationAccountId: account,
    channelListingId: "cl-1",
  })

const sentBody = (c: FakeWoo) => c.request.mock.calls[0]![2].body

test("pushes the available quantity and records last_synced_quantity on success", async () => {
  const s = setup()
  const c = woo()
  await run(s, medusa(7), c)
  expect(c.request).toHaveBeenCalledTimes(1)
  expect(c.request).toHaveBeenCalledWith("PUT", "/products/9", {
    body: { manage_stock: true, stock_quantity: 7 },
  })
  expect(s.job.status).toBe("succeeded")
  expect(s.job.external_id).toBe("cl-1")
  expect(s.row!.last_synced_quantity).toBe(7)
})

test("clamps a negative quantity at 0 for both the push and last_synced_quantity", async () => {
  const s = setup()
  const c = woo()
  await run(s, medusa(-3), c)
  expect(sentBody(c).stock_quantity).toBe(0)
  expect(s.row!.last_synced_quantity).toBe(0)
})

test("treats NaN quantity as 0", async () => {
  const s = setup()
  const c = woo()
  await run(s, medusa(Number.NaN), c)
  expect(sentBody(c).stock_quantity).toBe(0)
  expect(s.row!.last_synced_quantity).toBe(0)
})

test("a Woo 4xx becomes PermanentSyncError, records last_error, leaves last_synced_quantity", async () => {
  const s = setup()
  const c = woo(async () => {
    throw new Error("Woo request failed with status 422")
  })
  await expect(run(s, medusa(5), c)).rejects.toBeInstanceOf(PermanentSyncError)
  expect(s.job.status).toBe("failed")
  expect(s.job.last_error).toContain("422")
  expect(s.row!.last_synced_quantity).toBeNull()
})

test("a Woo 5xx is rethrown unchanged (retryable)", async () => {
  const s = setup()
  const c = woo(async () => {
    throw new Error("Woo request failed with status 503")
  })
  const p = run(s, medusa(5), c)
  await expect(p).rejects.toThrow(/503/)
  await expect(p).rejects.not.toBeInstanceOf(PermanentSyncError)
  expect(s.job.status).toBe("failed")
  expect(s.row!.last_synced_quantity).toBeNull()
})

test("a 429 is retryable, not permanent", async () => {
  const s = setup()
  const c = woo(async () => {
    throw new Error("429: throttled")
  })
  await expect(run(s, medusa(5), c)).rejects.not.toBeInstanceOf(PermanentSyncError)
})

test("a listing belonging to another account is a permanent failure and nothing is pushed", async () => {
  const s = setup({ integration_account_id: "other" })
  const c = woo()
  const m = medusa(5)
  await expect(run(s, m, c)).rejects.toBeInstanceOf(PermanentSyncError)
  expect(c.request).not.toHaveBeenCalled()
  expect(m.getVariantInventory).not.toHaveBeenCalled()
  expect(s.job.status).toBe("failed")
})

test("a missing listing is a permanent failure", async () => {
  const s = setup(null)
  const c = woo()
  await expect(run(s, medusa(5), c)).rejects.toBeInstanceOf(PermanentSyncError)
  expect(c.request).not.toHaveBeenCalled()
})

test("a variation is pushed to its parent product's variations endpoint", async () => {
  const s = setup({ external_variant_id: "21", external_parent_id: "20" })
  const c = woo()
  await run(s, medusa(3), c)
  expect(c.request).toHaveBeenCalledWith("PUT", "/products/20/variations/21", {
    body: { manage_stock: true, stock_quantity: 3 },
  })
})

test("floors a fractional quantity", async () => {
  const s = setup()
  const c = woo()
  await run(s, medusa(4.9), c)
  expect(sentBody(c).stock_quantity).toBe(4)
  expect(s.row!.last_synced_quantity).toBe(4)
})

test("a non-numeric WooCommerce id is a permanent failure", async () => {
  const s = setup({ external_variant_id: "abc" })
  const c = woo()
  await expect(run(s, medusa(5), c)).rejects.toBeInstanceOf(PermanentSyncError)
  expect(c.request).not.toHaveBeenCalled()
})

test("a listing without a WooCommerce id is a permanent failure", async () => {
  const s = setup({ external_variant_id: null })
  const c = woo()
  await expect(run(s, medusa(5), c)).rejects.toBeInstanceOf(PermanentSyncError)
  expect(c.request).not.toHaveBeenCalled()
})

test("keeps the job succeeded if recording last_synced_quantity fails", async () => {
  const s = setup({}, true)
  const c = woo()
  const spy = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    await run(s, medusa(4), c)
    expect(spy).toHaveBeenCalledTimes(1)
  } finally {
    spy.mockRestore()
  }
  expect(s.job.status).toBe("succeeded")
})
