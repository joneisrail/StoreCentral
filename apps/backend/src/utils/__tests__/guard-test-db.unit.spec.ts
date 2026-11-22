const { assertDisposableDatabase } = require("../../../integration-tests/guard-test-db")

describe("assertDisposableDatabase", () => {
  it.each(["medusa-abc123", "medusa-01hx-integration-1", "store_test"])(
    "accepts %s",
    (name) => {
      expect(() => assertDisposableDatabase(name)).not.toThrow()
    }
  )

  it.each(["storecentral", "postgres", ""])("rejects %j", (name) => {
    expect(() => assertDisposableDatabase(name)).toThrow(/throwaway/)
  })

  it("rejects non-string values", () => {
    expect(() => assertDisposableDatabase(undefined)).toThrow(/throwaway/)
  })

  it("never puts a connection string in the message", () => {
    const url = "postgres://user:secret@localhost:5432/storecentral"
    try {
      assertDisposableDatabase(url)
      throw new Error("expected guard to throw")
    } catch (e) {
      const message = (e as Error).message
      expect(message).not.toContain("secret")
      expect(message).not.toContain("postgres://")
      expect(message).not.toContain("storecentral")
    }
  })
})
