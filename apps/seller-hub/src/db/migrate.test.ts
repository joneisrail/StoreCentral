import { describe, expect, test } from "vitest"
import { loadEnv } from "../env.js"
import { assertTestDatabase } from "../test-support/database-guard.js"
import { createPool } from "./client.js"
import { runMigrations } from "./migrate.js"

// Runs migrations, so it only runs against a dedicated *_test database.
const testEnv = () => ({
  ...loadEnv(),
  databaseUrl: assertTestDatabase(process.env.TEST_DATABASE_URL),
})

describe.skipIf(!process.env.TEST_DATABASE_URL)("migrations (test database)", () => {
  test("runMigrations creates all three tables in the seller_hub schema", async () => {
    const pool = createPool(testEnv())
    await runMigrations(pool)
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'seller_hub' ORDER BY table_name`
    )
    expect(rows.map((r) => r.table_name)).toEqual([
      "amazon_settings",
      "channel_listing",
      "integration_account",
      "sync_job",
    ])
    await pool.end()
  })

  test("runMigrations is safe to call twice", async () => {
    const pool = createPool(testEnv())
    await runMigrations(pool)
    await expect(runMigrations(pool)).resolves.not.toThrow()
    await pool.end()
  })
})
