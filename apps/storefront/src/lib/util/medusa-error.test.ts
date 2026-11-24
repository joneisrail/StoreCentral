import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import medusaError from "./medusa-error"

const thrown = (input: unknown): Error => {
  try {
    medusaError(input)
  } catch (error) {
    return error as Error
  }
  throw new Error("medusaError did not throw")
}

describe("medusaError", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("uses the message from an axios-style response and ends it with a period", () => {
    const error = thrown({
      response: { data: { message: "cart not found" }, status: 404 },
      config: { url: "/store/carts/x", baseURL: "http://localhost:9000" },
    })
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe("Cart not found.")
  })

  it("handles a plain-string response body", () => {
    const error = thrown({ response: { data: "Bad gateway", status: 502 } })
    expect(error.message).toBe("Bad gateway.")
  })

  it("handles an object body with no message instead of crashing", () => {
    const error = thrown({ response: { data: {}, status: 500 } })
    expect(error.message).toBe("Request failed.")
  })

  it("handles the js-sdk FetchError shape", () => {
    const error = thrown({ status: 401, statusText: "Unauthorized", message: "Unauthorized" })
    expect(error.message).toBe("Unauthorized.")
  })

  it("reports an unreachable backend without echoing the request object", () => {
    const error = thrown({ request: { secret: "cookie=abc" } })
    expect(error.message).toBe("No response received from the store backend.")
    expect(error.message).not.toContain("abc")
  })

  it("copes with null, strings and empty objects", () => {
    expect(thrown(null).message).toBe("Error setting up the request.")
    expect(thrown({}).message).toBe("Error setting up the request.")
    expect(thrown(new Error("boom")).message).toBe("Boom.")
  })

  it("does not log response headers or bodies", () => {
    thrown({
      response: {
        data: { message: "nope" },
        status: 403,
        headers: { "set-cookie": "session=secret" },
      },
    })
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)
    expect(logged).not.toContain("secret")
    expect(logged).toContain("403")
  })
})
