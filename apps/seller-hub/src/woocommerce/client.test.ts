import { expect, test, vi } from "vitest"
import { PermanentSyncError } from "../queue/queues.js"
import { WooCommerceClient, WooCommerceHttpError } from "./client.js"

const ok = (body: unknown, headers: Record<string, string> = {}) => ({
  ok: true,
  status: 200,
  headers: new Headers(headers),
  json: async () => body,
})
const httpError = (status: number, headers: Record<string, string> = {}) => ({
  ok: false,
  status,
  headers: new Headers(headers),
  json: async () => ({ message: "nope" }),
})

const make = (fetchImpl: unknown, sleep = vi.fn(async (_ms: number) => {})) => ({
  sleep,
  client: new WooCommerceClient({
    siteUrl: "https://shop.example.com/",
    consumerKey: "ck_key123",
    consumerSecret: "cs_secret456",
    fetchImpl: fetchImpl as typeof fetch,
    sleep,
  }),
})

test("builds the v3 URL with query and sends Basic auth", async () => {
  const f = vi.fn().mockResolvedValue(ok([{ id: 1 }], { "X-WP-TotalPages": "3" }))
  const { client } = make(f)
  const out = await client.request<{ id: number }[]>("GET", "/products", {
    query: { per_page: 100, page: 2 },
  })
  expect(out).toEqual({ data: [{ id: 1 }], totalPages: 3 })
  const [url, init] = f.mock.calls[0]
  expect(url).toBe(
    "https://shop.example.com/wp-json/wc/v3/products?per_page=100&page=2"
  )
  expect(init.method).toBe("GET")
  expect(init.headers.Authorization).toBe(
    `Basic ${Buffer.from("ck_key123:cs_secret456").toString("base64")}`
  )
})

test("sends a JSON body and defaults totalPages to 1", async () => {
  const f = vi.fn().mockResolvedValue(ok({ id: 5 }))
  const { client } = make(f)
  const out = await client.request("PUT", "/products/5", { body: { a: 1 } })
  expect(out.totalPages).toBe(1)
  const [, init] = f.mock.calls[0]
  expect(init.method).toBe("PUT")
  expect(init.headers["Content-Type"]).toBe("application/json")
  expect(JSON.parse(init.body)).toEqual({ a: 1 })
})

test("refuses a non-https site URL at construction", () => {
  expect(
    () =>
      new WooCommerceClient({
        siteUrl: "http://shop.example.com",
        consumerKey: "k",
        consumerSecret: "s",
      })
  ).toThrow(/https/)
})

test.each([401, 403, 404])(
  "%i is permanent and never leaks credentials",
  async (status) => {
    const f = vi.fn().mockResolvedValue(httpError(status))
    const { client } = make(f)
    const err = await client.request("GET", "/products").catch((e) => e)
    expect(err).toBeInstanceOf(PermanentSyncError)
    expect(err.message).not.toContain("ck_key123")
    expect(err.message).not.toContain("cs_secret456")
    expect(err.message).toContain(String(status))
    expect(err).toBeInstanceOf(WooCommerceHttpError)
    expect(err.status).toBe(status)
  }
)

test("429 waits Retry-After then retries once", async () => {
  const f = vi
    .fn()
    .mockResolvedValueOnce(httpError(429, { "Retry-After": "2" }))
    .mockResolvedValueOnce(ok({ ok: true }))
  const { client, sleep } = make(f)
  const out = await client.request("GET", "/products")
  expect(out.data).toEqual({ ok: true })
  expect(f).toHaveBeenCalledTimes(2)
  expect(sleep).toHaveBeenCalledWith(2000)
})

test("429 wait is capped and retries are bounded", async () => {
  const f = vi.fn().mockResolvedValue(httpError(429, { "Retry-After": "9999" }))
  const { client, sleep } = make(f)
  await expect(client.request("GET", "/products")).rejects.toThrow(/throttled/)
  expect(f).toHaveBeenCalledTimes(5)
  for (const [ms] of sleep.mock.calls) expect(ms).toBeLessThanOrEqual(30_000)
})

test("5xx is a plain retryable Error", async () => {
  const f = vi.fn().mockResolvedValue(httpError(500))
  const { client } = make(f)
  const err = await client.request("GET", "/products").catch((e) => e)
  expect(err).toBeInstanceOf(Error)
  expect(err).not.toBeInstanceOf(PermanentSyncError)
})

test("network errors propagate as plain errors", async () => {
  const f = vi.fn().mockRejectedValue(new Error("ECONNRESET"))
  const { client } = make(f)
  const err = await client.request("GET", "/products").catch((e) => e)
  expect(err).not.toBeInstanceOf(PermanentSyncError)
})
