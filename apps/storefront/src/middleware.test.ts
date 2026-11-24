import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const region = {
  id: "reg_1",
  name: "United States",
  currency_code: "usd",
  countries: [{ iso_2: "us" }],
}

const request = (path = "/store") => new NextRequest(`http://localhost:8000${path}`)

describe("middleware", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv("NEXT_PUBLIC_MEDUSA_BACKEND_URL", "http://backend.test")
    vi.stubEnv("NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY", "pk_test")
    vi.stubEnv("NEXT_PUBLIC_DEFAULT_REGION", "")
    vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("answers 503 with Retry-After when the backend cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")))
    const { middleware } = await import("./middleware")

    const response = await middleware(request())

    expect(response.status).toBe(503)
    expect(response.headers.get("Retry-After")).toBe("30")
  })

  it("answers 503 when the backend returns an error status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })))
    const { middleware } = await import("./middleware")

    const response = await middleware(request())

    expect(response.status).toBe(503)
  })

  it("rewrites to the US region when no default region is configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ regions: [region] }), { status: 200 })
      )
    )
    const { middleware } = await import("./middleware")

    const response = await middleware(request("/store"))

    expect(response.status).toBe(200)
    expect(response.headers.get("x-middleware-rewrite")).toContain("/us/store")
  })
})
