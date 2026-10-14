import { expect, test } from "vitest"
import { loadEnv } from "../env.js"
import { createPool } from "./client.js"
import { runMigrations } from "./migrate.js"

test("runMigrations creates all three tables in the seller_hub schema", async () => {
  const pool = createPool(loadEnv())
  await runMigrations(pool)
  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'seller_hub' ORDER BY table_name`
  )
  expect(rows.map((r) => r.table_name)).toEqual([
    "channel_listing",
    "integration_account",
    "sync_job",
  ])
  await pool.end()
})

test("runMigrations is safe to call twice", async () => {
  const pool = createPool(loadEnv())
  await runMigrations(pool)
  await expect(runMigrations(pool)).resolves.not.toThrow()
  await pool.end()
})
