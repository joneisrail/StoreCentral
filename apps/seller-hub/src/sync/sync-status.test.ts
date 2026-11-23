import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { Pool } from "pg"
import { assertTestDatabase } from "../test-support/database-guard.js"
import { runMigrations } from "../db/migrate.js"
import { getSyncStatus, SYNC_FAILURE_LIMIT } from "./sync-status.js"

describe.skipIf(!process.env.TEST_DATABASE_URL)("sync status (test database)", () => {
  let pool: Pool
  const accounts: string[] = []

  beforeAll(async () => {
    pool = new Pool({ connectionString: assertTestDatabase(process.env.TEST_DATABASE_URL) })
    await runMigrations(pool)
  }, 30_000)

  afterAll(async () => {
    if (pool && accounts.length > 0) {
      await pool.query(`DELETE FROM seller_hub.sync_job WHERE integration_account_id = ANY($1::uuid[])`, [accounts])
      await pool.query(`DELETE FROM seller_hub.channel_listing WHERE integration_account_id = ANY($1::uuid[])`, [accounts])
      await pool.query(`DELETE FROM seller_hub.integration_account WHERE id = ANY($1::uuid[])`, [accounts])
    }
    await pool?.end()
  })

  const newAccount = async (lastError: string | null = null): Promise<string> => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO seller_hub.integration_account (marketplace, status, last_error)
       VALUES ('woocommerce', 'connected', $1) RETURNING id`,
      [lastError]
    )
    accounts.push(rows[0]!.id)
    return rows[0]!.id
  }

  let seq = 0
  const listing = async (
    acct: string,
    status: string,
    opts: { error?: string | null; quantity?: number | null } = {}
  ) => {
    seq += 1
    await pool.query(
      `INSERT INTO seller_hub.channel_listing
         (integration_account_id, medusa_product_id, medusa_variant_id, external_sku, status, last_error, last_synced_quantity)
       VALUES ($1, 'p', 'v', $2, $3, $4, $5)`,
      [acct, `SKU-${seq}`, status, opts.error ?? null, opts.quantity === undefined ? 1 : opts.quantity]
    )
  }

  const job = async (
    acct: string,
    type: string,
    externalId: string,
    status: string,
    opts: { attempts?: number; error?: string | null; updatedAt?: string } = {}
  ) => {
    await pool.query(
      `INSERT INTO seller_hub.sync_job
         (integration_account_id, sync_type, external_id, status, attempts, last_error, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()))`,
      [acct, type, externalId, status, opts.attempts ?? 0, opts.error ?? null, opts.updatedAt ?? null]
    )
  }

  test("unknown account returns null", async () => {
    expect(await getSyncStatus(pool, "00000000-0000-0000-0000-000000000000")).toBeNull()
  })

  test("empty account returns zeros and nulls", async () => {
    const acct = await newAccount()
    expect(await getSyncStatus(pool, acct)).toEqual({
      connection: { status: "connected", last_error: null, last_synced_at: null },
      listings: { total: 0, by_status: {}, with_error: 0, never_pushed: 0 },
      jobs: {
        by_type: {
          product: { pending: 0, processing: 0, failed: 0, succeeded: 0 },
          inventory: { pending: 0, processing: 0, failed: 0, succeeded: 0 },
          price: { pending: 0, processing: 0, failed: 0, succeeded: 0 },
          order: { pending: 0, processing: 0, failed: 0, succeeded: 0 },
          tracking: { pending: 0, processing: 0, failed: 0, succeeded: 0 },
        },
        last_succeeded_at: { product: null, inventory: null, price: null, order: null, tracking: null },
      },
      recent_failures: [],
      failures_total: 0,
    })
  })

  test("counts listings by status with errors and never pushed", async () => {
    const acct = await newAccount()
    await listing(acct, "published")
    await listing(acct, "published", { error: "boom" })
    await listing(acct, "error", { error: "bad", quantity: null })
    await listing(acct, "draft", { quantity: null })
    await listing(acct, "published", { error: "" })

    const s = await getSyncStatus(pool, acct)
    expect(s!.listings).toEqual({
      total: 5,
      by_status: { published: 3, error: 1, draft: 1 },
      with_error: 2,
      never_pushed: 2,
    })
  })

  test("counts jobs by type and status and last success time", async () => {
    const acct = await newAccount()
    await job(acct, "inventory", "a", "pending")
    await job(acct, "inventory", "b", "processing")
    await job(acct, "inventory", "c", "failed", { error: "x" })
    await job(acct, "inventory", "d", "succeeded", { updatedAt: "2026-01-01T00:00:00Z" })
    await job(acct, "inventory", "e", "succeeded", { updatedAt: "2026-02-01T00:00:00Z" })
    await job(acct, "order", "o1", "succeeded", { updatedAt: "2026-03-01T00:00:00Z" })
    await job(acct, "price", "p1", "failed", { error: "y" })

    const s = await getSyncStatus(pool, acct)
    expect(s!.jobs.by_type.inventory).toEqual({ pending: 1, processing: 1, failed: 1, succeeded: 2 })
    expect(s!.jobs.by_type.order).toEqual({ pending: 0, processing: 0, failed: 0, succeeded: 1 })
    expect(s!.jobs.by_type.price).toEqual({ pending: 0, processing: 0, failed: 1, succeeded: 0 })
    expect(s!.jobs.by_type.product).toEqual({ pending: 0, processing: 0, failed: 0, succeeded: 0 })
    expect(s!.jobs.last_succeeded_at).toEqual({
      product: null,
      inventory: "2026-02-01T00:00:00.000Z",
      price: null,
      order: "2026-03-01T00:00:00.000Z",
      tracking: null,
    })
  })

  test("recent failures newest first capped at 25 with total", async () => {
    const acct = await newAccount()
    for (let i = 0; i < 30; i++) {
      const day = String(i + 1).padStart(2, "0")
      await job(acct, "inventory", `F-${day}`, "failed", {
        attempts: i,
        error: `err ${i}`,
        updatedAt: `2026-04-${day}T00:00:00Z`,
      })
    }
    await job(acct, "inventory", "OK", "succeeded")

    const s = await getSyncStatus(pool, acct)
    expect(SYNC_FAILURE_LIMIT).toBe(25)
    expect(s!.failures_total).toBe(30)
    expect(s!.recent_failures).toHaveLength(25)
    expect(s!.recent_failures[0]).toEqual({
      sync_type: "inventory",
      external_id: "F-30",
      attempts: 29,
      last_error: "err 29",
      updated_at: "2026-04-30T00:00:00.000Z",
    })
    expect(s!.recent_failures[24]!.external_id).toBe("F-06")
  })

  test("other accounts rows are excluded", async () => {
    const mine = await newAccount()
    const other = await newAccount("other problem")
    await listing(other, "published")
    await job(other, "order", "x", "failed", { error: "nope" })
    await job(other, "order", "y", "succeeded")

    const s = await getSyncStatus(pool, mine)
    expect(s!.listings.total).toBe(0)
    expect(s!.failures_total).toBe(0)
    expect(s!.recent_failures).toEqual([])
    expect(s!.jobs.by_type.order.succeeded).toBe(0)
    expect(s!.jobs.last_succeeded_at.order).toBeNull()
    expect(s!.connection.last_error).toBeNull()
  })

  test("error text redacted and truncated to 300", async () => {
    const acct = await newAccount("failed with access_token=shpat_supersecret1 " + "z".repeat(500))
    await job(acct, "price", "R1", "failed", { error: "Bearer abc.def-ghi " + "q".repeat(500) })

    const s = await getSyncStatus(pool, acct)
    expect(s!.connection.last_error).not.toContain("supersecret")
    expect(s!.connection.last_error).toContain("[redacted]")
    expect(s!.connection.last_error!.length).toBeLessThanOrEqual(300)
    const f = s!.recent_failures[0]!
    expect(f.last_error).not.toContain("abc.def")
    expect(f.last_error).toContain("[redacted]")
    expect(f.last_error!.length).toBeLessThanOrEqual(300)
  })

  test("failures show the SKU of the listing they belong to", async () => {
    const acct = await newAccount()
    const other = await newAccount()
    const ins = async (a: string, sku: string, variant: string) =>
      (
        await pool.query<{ id: string }>(
          `INSERT INTO seller_hub.channel_listing (integration_account_id, medusa_product_id, medusa_variant_id, external_sku)
           VALUES ($1, 'p', $2, $3) RETURNING id`,
          [a, variant, sku]
        )
      ).rows[0]!.id
    const byId = await ins(acct, "SKU-BY-ID", "var_a")
    await ins(acct, "SKU-BY-VARIANT", "var_b")
    await ins(other, "OTHER-SKU", "var_c")
    // two listings share a variant id: still one row for the failure
    await ins(acct, "DUP-1", "var_d")
    await ins(acct, "DUP-2", "var_d")
    await job(acct, "inventory", byId, "failed", { updatedAt: "2026-05-01T00:00:00Z" })
    await job(acct, "price", "var_b", "failed", { updatedAt: "2026-05-02T00:00:00Z" })
    await job(acct, "price", "mystery", "failed", { updatedAt: "2026-05-03T00:00:00Z" })
    await job(acct, "price", "var_c", "failed", { updatedAt: "2026-05-04T00:00:00Z" })
    await job(acct, "price", "var_d", "failed", { updatedAt: "2026-05-05T00:00:00Z" })

    const s = await getSyncStatus(pool, acct)
    expect(s!.failures_total).toBe(5)
    expect(s!.recent_failures.map((f) => f.external_id)).toEqual([
      "DUP-1",
      "var_c",
      "mystery",
      "SKU-BY-VARIANT",
      "SKU-BY-ID",
    ])
  })
})
