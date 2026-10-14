import { afterAll, beforeAll, expect, test } from "vitest"
import type { Pool } from "pg"
import { loadEnv } from "../env.js"
import { createPool } from "../db/client.js"
import { runMigrations } from "../db/migrate.js"
import { markSyncJobFailed, markSyncJobSucceeded } from "./sync-job-tracking.js"

let pool: Pool
let integrationAccountId: string

/**
 * Inserts a real `pending` `seller_hub.sync_job` row (via a real
 * `integration_account` row, since `sync_job.integration_account_id` is a
 * NOT NULL foreign key) and returns its id.
 */
const insertTestSyncJob = async (p: Pool): Promise<string> => {
  const { rows } = await p.query<{ id: string }>(
    `INSERT INTO seller_hub.sync_job
       (integration_account_id, sync_type, external_id, status, attempts)
     VALUES ($1, 'order', $2, 'pending', 0)
     RETURNING id`,
    [integrationAccountId, "TEST-SYNC-JOB-" + Date.now() + "-" + Math.random()]
  )
  return rows[0]!.id
}

beforeAll(async () => {
  const env = loadEnv()
  pool = createPool(env)
  await runMigrations(pool)

  const accountResult = await pool.query<{ id: string }>(
    `INSERT INTO seller_hub.integration_account (marketplace, status)
     VALUES ('amazon', 'connected')
     RETURNING id`
  )
  integrationAccountId = accountResult.rows[0]!.id
}, 30_000)

afterAll(async () => {
  await pool.end()
})

test("markSyncJobFailed sets status=failed and records the error", async () => {
  const jobId = await insertTestSyncJob(pool)
  await markSyncJobFailed(pool, jobId, "boom")
  const { rows } = await pool.query(
    "SELECT status, last_error FROM seller_hub.sync_job WHERE id = $1",
    [jobId]
  )
  expect(rows[0]).toEqual({ status: "failed", last_error: "boom" })
})

test("markSyncJobSucceeded sets status=succeeded, records medusa_entity_id, and clears last_error", async () => {
  const jobId = await insertTestSyncJob(pool)

  // Give it a prior failure first, to prove success clears it.
  await markSyncJobFailed(pool, jobId, "transient failure before retry")

  await markSyncJobSucceeded(pool, jobId, "order_123")
  const { rows } = await pool.query(
    "SELECT status, last_error, medusa_entity_id FROM seller_hub.sync_job WHERE id = $1",
    [jobId]
  )
  expect(rows[0]).toEqual({
    status: "succeeded",
    last_error: null,
    medusa_entity_id: "order_123",
  })
})

test("markSyncJobSucceeded works without a medusaEntityId", async () => {
  const jobId = await insertTestSyncJob(pool)
  await markSyncJobSucceeded(pool, jobId)
  const { rows } = await pool.query(
    "SELECT status, medusa_entity_id FROM seller_hub.sync_job WHERE id = $1",
    [jobId]
  )
  expect(rows[0]).toEqual({ status: "succeeded", medusa_entity_id: null })
})
