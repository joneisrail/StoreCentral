import { expect, test, vi } from "vitest"
import { SpApiClient } from "./client.js"

const TOKEN_URL = "https://api.amazon.com/auth/o2/token"
const BASE_URL = "https://sandbox.sellingpartnerapi-na.amazon.com"

const tokenResponse = (accessToken = "atza-fake", expiresIn = 3600) => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  json: async () => ({ access_token: accessToken, expires_in: expiresIn }),
})

test("request() retries once on 429 then succeeds", async () => {
  let operationCalls = 0
  const fakeFetch = vi.fn().mockImplementation(async (url: string) => {
    if (url.toString().startsWith(TOKEN_URL)) {
      return tokenResponse()
    }
    operationCalls += 1
    if (operationCalls === 1) {
      return {
        ok: false,
        status: 429,
        headers: new Headers({ "Retry-After": "0" }),
        json: async () => ({}),
      }
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ orderId: "ORDER-1" }),
    }
  })

  const client = new SpApiClient({
    baseUrl: BASE_URL,
    refreshToken: "r",
    clientId: "c",
    clientSecret: "s",
    fetchImpl: fakeFetch as unknown as typeof fetch,
  })

  const result = await client.request<{ orderId: string }>({
    name: "getOrder",
    method: "GET",
    path: "/orders/v0/orders/ORDER-1",
    rateLimit: { ratePerSecond: 10, burst: 10 },
  })

  expect(result).toEqual({ orderId: "ORDER-1" })
  expect(operationCalls).toBe(2)
})

test("request() throws immediately on a non-429 4xx without retrying", async () => {
  let operationCalls = 0
  const fakeFetch = vi.fn().mockImplementation(async (url: string) => {
    if (url.toString().startsWith(TOKEN_URL)) {
      return tokenResponse()
    }
    operationCalls += 1
    return {
      ok: false,
      status: 400,
      headers: new Headers(),
      json: async () => ({ errors: [{ message: "bad request" }] }),
    }
  })

  const client = new SpApiClient({
    baseUrl: BASE_URL,
    refreshToken: "r",
    clientId: "c",
    clientSecret: "s",
    fetchImpl: fakeFetch as unknown as typeof fetch,
  })

  await expect(
    client.request({
      name: "getOrder",
      method: "GET",
      path: "/x",
      rateLimit: { ratePerSecond: 10, burst: 10 },
    })
  ).rejects.toThrow(/400/)

  // exactly one call to the operation endpoint — no retry loop
  expect(operationCalls).toBe(1)
})

test("gives up after 3 attempts on persistent 5xx and throws with status and body", async () => {
  let operationCalls = 0
  const fakeFetch = vi.fn().mockImplementation(async (url: string) => {
    if (url.toString().startsWith(TOKEN_URL)) {
      return tokenResponse()
    }
    operationCalls += 1
    return {
      ok: false,
      status: 503,
      headers: new Headers({ "Retry-After": "0" }),
      json: async () => ({ error: "unavailable" }),
    }
  })

  const client = new SpApiClient({
    baseUrl: BASE_URL,
    refreshToken: "r",
    clientId: "c",
    clientSecret: "s",
    fetchImpl: fakeFetch as unknown as typeof fetch,
  })

  await expect(
    client.request({
      name: "getOrder",
      method: "GET",
      path: "/x",
      rateLimit: { ratePerSecond: 10, burst: 10 },
    })
  ).rejects.toThrow(/503/)

  expect(operationCalls).toBe(3)
})

test("caches the access token across requests instead of refreshing every call", async () => {
  let tokenCalls = 0
  const fakeFetch = vi.fn().mockImplementation(async (url: string) => {
    if (url.toString().startsWith(TOKEN_URL)) {
      tokenCalls += 1
      return tokenResponse(`atza-${tokenCalls}`)
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ ok: true }),
    }
  })

  const client = new SpApiClient({
    baseUrl: BASE_URL,
    refreshToken: "r",
    clientId: "c",
    clientSecret: "s",
    fetchImpl: fakeFetch as unknown as typeof fetch,
  })

  await client.request({
    name: "getOrder",
    method: "GET",
    path: "/a",
    rateLimit: { ratePerSecond: 10, burst: 10 },
  })
  await client.request({
    name: "getOrder",
    method: "GET",
    path: "/b",
    rateLimit: { ratePerSecond: 10, burst: 10 },
  })

  expect(tokenCalls).toBe(1)
})

test("refreshes the access token again once the cached one is within 60s of expiring", async () => {
  vi.useFakeTimers()
  try {
    let tokenCalls = 0
    const fakeFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.toString().startsWith(TOKEN_URL)) {
        tokenCalls += 1
        return tokenResponse(`atza-${tokenCalls}`, 100) // expires in 100s
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ ok: true }),
      }
    })

    const client = new SpApiClient({
      baseUrl: BASE_URL,
      refreshToken: "r",
      clientId: "c",
      clientSecret: "s",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    })

    await client.request({
      name: "getOrder",
      method: "GET",
      path: "/a",
      rateLimit: { ratePerSecond: 10, burst: 10 },
    })
    expect(tokenCalls).toBe(1)

    // 50s elapsed of a 100s token => 50s remaining, under the 60s buffer
    await vi.advanceTimersByTimeAsync(50_000)

    await client.request({
      name: "getOrder",
      method: "GET",
      path: "/b",
      rateLimit: { ratePerSecond: 10, burst: 10 },
    })
    expect(tokenCalls).toBe(2)
  } finally {
    vi.useRealTimers()
  }
})

test("backs off exponentially with jitter when no Retry-After header is present", async () => {
  vi.useFakeTimers()
  try {
    let operationCalls = 0
    const fakeFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.toString().startsWith(TOKEN_URL)) {
        return tokenResponse()
      }
      operationCalls += 1
      if (operationCalls < 3) {
        return {
          ok: false,
          status: 503,
          headers: new Headers(), // no Retry-After
          json: async () => ({}),
        }
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ done: true }),
      }
    })

    const client = new SpApiClient({
      baseUrl: BASE_URL,
      refreshToken: "r",
      clientId: "c",
      clientSecret: "s",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    })

    let resolved = false
    const promise = client
      .request({
        name: "getOrder",
        method: "GET",
        path: "/x",
        rateLimit: { ratePerSecond: 10, burst: 10 },
      })
      .then((value) => {
        resolved = true
        return value
      })

    // Backoff #1 is jittered to 50%-100% of 2**1*200 = 400ms, i.e. a value
    // in [200, 400). 199ms is below that guaranteed minimum, so the retry
    // timer cannot have fired yet no matter how the jitter rolled.
    await vi.advanceTimersByTimeAsync(199)
    expect(resolved).toBe(false)

    // Backoff #2 (after the 2nd attempt also fails) is jittered to
    // 50%-100% of 2**2*200 = 800ms, i.e. a value in [400, 800). Even in the
    // worst case (both backoffs near their unjittered max), total elapsed
    // time before the 3rd attempt fires is strictly less than 400 + 800 =
    // 1200ms. Advancing well past that guarantees completion regardless of
    // how the jitter rolled.
    await vi.advanceTimersByTimeAsync(1200)
    expect(resolved).toBe(true)

    expect(await promise).toEqual({ done: true })
    expect(operationCalls).toBe(3)
  } finally {
    vi.useRealTimers()
  }
})

test("applies a separate rate-limit bucket per operation name", async () => {
  vi.useFakeTimers()
  try {
    const fakeFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.toString().startsWith(TOKEN_URL)) {
        return tokenResponse()
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ ok: true }),
      }
    })

    const client = new SpApiClient({
      baseUrl: BASE_URL,
      refreshToken: "r",
      clientId: "c",
      clientSecret: "s",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    })

    // exhausts the "getOrder" bucket's single token
    await client.request({
      name: "getOrder",
      method: "GET",
      path: "/a",
      rateLimit: { ratePerSecond: 1, burst: 1 },
    })

    // a different operation name must get its own fresh bucket, so this
    // resolves immediately instead of waiting ~1s for getOrder's refill
    let resolved = false
    void client
      .request({
        name: "getPricing",
        method: "GET",
        path: "/b",
        rateLimit: { ratePerSecond: 1, burst: 1 },
      })
      .then(() => {
        resolved = true
      })

    await vi.advanceTimersByTimeAsync(10)
    expect(resolved).toBe(true)
  } finally {
    vi.useRealTimers()
  }
})
