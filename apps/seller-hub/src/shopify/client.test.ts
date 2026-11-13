import { expect, test, vi } from "vitest"
import { PermanentSyncError } from "../queue/queues.js"
import { ShopifyClient, SHOPIFY_API_VERSION } from "./client.js"

const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  json: async () => body,
})
const httpError = (status: number, headers: Record<string, string> = {}) => ({
  ok: false,
  status,
  headers: new Headers(headers),
  json: async () => ({ errors: "nope" }),
})

const make = (fetchImpl: unknown, sleep = vi.fn(async (_ms: number) => {})) => ({
  sleep,
  client: new ShopifyClient({
    shopDomain: "shop.myshopify.com",
    accessToken: "shpat_secret",
    fetchImpl: fetchImpl as typeof fetch,
    sleep,
  }),
})

test("posts to the pinned-version URL with the access token header", async () => {
  const f = vi.fn().mockResolvedValue(ok({ data: { a: 1 } }))
  const { client } = make(f)
  const out = await client.graphql<{ a: number }>("query { a }", { x: 1 })
  expect(out).toEqual({ a: 1 })
  const [url, init] = f.mock.calls[0]
  expect(url).toBe(
    `https://shop.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/graphql.json`
  )
  expect(init.method).toBe("POST")
  expect(init.headers["X-Shopify-Access-Token"]).toBe("shpat_secret")
  expect(JSON.parse(init.body)).toEqual({
    query: "query { a }",
    variables: { x: 1 },
  })
})

test("THROTTLED then success retries once after waiting", async () => {
  const f = vi
    .fn()
    .mockResolvedValueOnce(
      ok({
        errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
        extensions: {
          cost: {
            requestedQueryCost: 100,
            throttleStatus: { currentlyAvailable: 50, restoreRate: 50 },
          },
        },
      })
    )
    .mockResolvedValueOnce(ok({ data: { a: 1 } }))
  const { client, sleep } = make(f)
  expect(await client.graphql("q")).toEqual({ a: 1 })
  expect(f).toHaveBeenCalledTimes(2)
  expect(sleep).toHaveBeenCalledWith(1000)
})

test("HTTP 429 honors Retry-After then retries", async () => {
  const f = vi
    .fn()
    .mockResolvedValueOnce(httpError(429, { "Retry-After": "2" }))
    .mockResolvedValueOnce(ok({ data: { a: 1 } }))
  const { client, sleep } = make(f)
  await client.graphql("q")
  expect(sleep).toHaveBeenCalledWith(2000)
})

test("gives up after bounded throttle retries with a plain Error", async () => {
  const f = vi.fn().mockResolvedValue(httpError(429))
  const { client } = make(f)
  const err = await client.graphql("q").catch((e) => e)
  expect(err).toBeInstanceOf(Error)
  expect(err).not.toBeInstanceOf(PermanentSyncError)
  expect(f.mock.calls.length).toBeLessThanOrEqual(5)
})

test.each([401, 403, 404])("%i is a PermanentSyncError", async (status) => {
  const { client } = make(vi.fn().mockResolvedValue(httpError(status)))
  await expect(client.graphql("q")).rejects.toBeInstanceOf(PermanentSyncError)
})

test("500 and network errors are plain retryable Errors", async () => {
  const a = await make(vi.fn().mockResolvedValue(httpError(500)))
    .client.graphql("q")
    .catch((e) => e)
  expect(a).toBeInstanceOf(Error)
  expect(a).not.toBeInstanceOf(PermanentSyncError)
  const b = await make(vi.fn().mockRejectedValue(new Error("ECONNRESET")))
    .client.graphql("q")
    .catch((e) => e)
  expect(b.message).toContain("ECONNRESET")
  expect(b).not.toBeInstanceOf(PermanentSyncError)
})

test("GraphQL access-denied errors are permanent and never leak the token", async () => {
  const { client } = make(
    vi.fn().mockResolvedValue(
      ok({
        errors: [
          { message: "Access denied", extensions: { code: "ACCESS_DENIED" } },
        ],
      })
    )
  )
  const err = await client.graphql("q").catch((e) => e)
  expect(err).toBeInstanceOf(PermanentSyncError)
  expect(err.message).not.toContain("shpat_secret")
})
