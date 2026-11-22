import { describe, expect, test } from "vitest"
import { assertTestDatabase } from "./database-guard.js"

describe("assertTestDatabase", () => {
  test("returns the url when the database name ends in _test", () => {
    const url = "postgres://u:p@h:5432/app_test"
    expect(assertTestDatabase(url)).toBe(url)
  })

  test.each([
    ["a non-test database", "postgres://u:p@h:5432/app"],
    ["a name that only contains _test", "postgres://u:p@h:5432/app_test_backup"],
    ["an undefined url", undefined],
    ["an empty url", ""],
  ])("throws for %s", (_label, url) => {
    expect(() => assertTestDatabase(url)).toThrow(/TEST_DATABASE_URL/)
  })

  test("never includes the connection string in the message", () => {
    let message = ""
    try {
      assertTestDatabase("postgres://u:p@h:5432/app")
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toContain("TEST_DATABASE_URL")
    expect(message).not.toContain("p@h")
  })
})
