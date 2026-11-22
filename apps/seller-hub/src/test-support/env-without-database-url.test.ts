import { describe, expect, it } from "vitest"
import { withoutDatabaseUrl } from "./env-without-database-url.js"

describe("withoutDatabaseUrl", () => {
  it("drops DATABASE_URL and keeps every other value", () => {
    const env = { DATABASE_URL: "postgres://real/db", REDIS_URL: "redis://x", A: "1" }
    expect(withoutDatabaseUrl(env)).toEqual({ REDIS_URL: "redis://x", A: "1" })
  })

  it("does not mutate the input", () => {
    const env = { DATABASE_URL: "postgres://real/db" }
    withoutDatabaseUrl(env)
    expect(env).toEqual({ DATABASE_URL: "postgres://real/db" })
  })

  it("is a no-op copy when there is no DATABASE_URL", () => {
    const env = { A: "1" }
    const out = withoutDatabaseUrl(env)
    expect(out).toEqual({ A: "1" })
    expect(out).not.toBe(env)
  })
})
