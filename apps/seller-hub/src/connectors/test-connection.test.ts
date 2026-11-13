import { describe, expect, it, vi } from "vitest"
import { testShopifyConnection, testWooCommerceConnection } from "./test-connection.js"

const TOKEN = "shpat_SECRET_TOKEN_12345"
const SECRET = "cs_SECRET_VALUE_67890"
const KEY = "ck_KEY_VALUE_24680"

const shopifyCfg = {
  shopDomain: "demo.myshopify.com",
  accessToken: TOKEN,
  webhookSecret: "whsec_x",
  locationId: "12345",
}
const wooCfg = {
  siteUrl: "https://shop.example.com",
  consumerKey: KEY,
  consumerSecret: SECRET,
  webhookSecret: "whsec_y",
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

const noLeak = (r: { ok: boolean } & Record<string, unknown>) => {
  expect(r.ok).toBe(false)
  const m = String(r.message)
  for (const s of [TOKEN, SECRET, KEY, "?per_page"]) expect(m).not.toContain(s)
}

describe("testShopifyConnection", () => {
  it("returns ok with the shop name", async () => {
    const fetchImpl = vi.fn(async () => json({ data: { shop: { name: "Demo Shop" }, location: { id: "gid://shopify/Location/12345" } } }))
    const r = await testShopifyConnection(shopifyCfg, { fetchImpl: fetchImpl as any })
    expect(r).toEqual({ ok: true, detail: expect.stringContaining("Demo Shop") })
    const [url, init] = fetchImpl.mock.calls[0] as any
    expect(String(url)).toContain("demo.myshopify.com")
    expect(init.headers["X-Shopify-Access-Token"]).toBe(TOKEN)
    const body = JSON.parse(init.body)
    expect(body.query).toContain("shop")
    expect(body.variables.id).toBe("gid://shopify/Location/12345")
  })

  it("maps 401 to credentials rejected", async () => {
    const r = await testShopifyConnection(shopifyCfg, { fetchImpl: (async () => json({}, 401)) as any })
    noLeak(r)
    expect((r as any).message).toMatch(/credentials rejected/i)
  })

  it("fails when the location is not found", async () => {
    const r = await testShopifyConnection(shopifyCfg, {
      fetchImpl: (async () => json({ data: { shop: { name: "Demo" }, location: null } })) as any,
    })
    noLeak(r)
    expect((r as any).message).toMatch(/location not found/i)
  })

  it("handles a network error without leaking", async () => {
    const r = await testShopifyConnection(shopifyCfg, {
      fetchImpl: (async () => { throw new Error(`boom ${TOKEN}`) }) as any,
    })
    noLeak(r)
  })

  it("times out on a fetch that never resolves", async () => {
    const r = await testShopifyConnection(shopifyCfg, {
      fetchImpl: (() => new Promise(() => {})) as any,
      timeoutMs: 20,
    })
    noLeak(r)
    expect((r as any).message).toMatch(/timed out/i)
  })
})

describe("testWooCommerceConnection", () => {
  it("returns ok", async () => {
    const fetchImpl = vi.fn(async () => json([{ id: 1 }]))
    const r = await testWooCommerceConnection(wooCfg, { fetchImpl: fetchImpl as any })
    expect(r.ok).toBe(true)
    expect(String(fetchImpl.mock.calls[0]![0])).toContain("/products?per_page=1")
  })

  it("maps 401 to credentials rejected", async () => {
    const r = await testWooCommerceConnection(wooCfg, { fetchImpl: (async () => json({}, 401)) as any })
    noLeak(r)
    expect((r as any).message).toMatch(/credentials rejected/i)
  })

  it("maps 404 to not found", async () => {
    const r = await testWooCommerceConnection(wooCfg, { fetchImpl: (async () => json({}, 404)) as any })
    noLeak(r)
    expect((r as any).message).toMatch(/not found/i)
  })

  it("handles a network error without leaking", async () => {
    const r = await testWooCommerceConnection(wooCfg, {
      fetchImpl: (async () => { throw new Error(`boom ${SECRET} ${KEY}`) }) as any,
    })
    noLeak(r)
  })

  it("times out", async () => {
    const r = await testWooCommerceConnection(wooCfg, {
      fetchImpl: (() => new Promise(() => {})) as any,
      timeoutMs: 20,
    })
    noLeak(r)
    expect((r as any).message).toMatch(/timed out/i)
  })

  it("rejects a non-https URL before any request", async () => {
    const fetchImpl = vi.fn()
    const r = await testWooCommerceConnection({ ...wooCfg, siteUrl: "http://shop.example.com" }, { fetchImpl: fetchImpl as any })
    noLeak(r)
    expect((r as any).message).toMatch(/https/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

const hangingFetch = (capture: { signal?: AbortSignal }) => (_u: any, init: any) =>
  new Promise((_res, rej) => {
    capture.signal = init.signal
    init.signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))
  })

describe("testWooCommerceConnection extra", () => {
  it("maps 5xx to request failed", async () => {
    const r = await testWooCommerceConnection(wooCfg, { fetchImpl: (async () => json({}, 500)) as any })
    noLeak(r)
    expect((r as any).message).toBe("request failed (500)")
  })

  it("reports persistent 429 as rate limiting", async () => {
    const r = await testWooCommerceConnection(wooCfg, { fetchImpl: (async () => json({}, 429)) as any })
    noLeak(r)
    expect((r as any).message).toMatch(/rate limiting/)
  })

  it("aborts the hung request on timeout", async () => {
    const cap: { signal?: AbortSignal } = {}
    const r = await testWooCommerceConnection(wooCfg, { fetchImpl: hangingFetch(cap) as any, timeoutMs: 20 })
    expect((r as any).message).toMatch(/timed out/i)
    expect(cap.signal?.aborted).toBe(true)
  })

  it("does not throw on a missing or whitespace-led siteUrl", async () => {
    const fetchImpl = vi.fn()
    const r1 = await testWooCommerceConnection({ ...wooCfg, siteUrl: undefined as any }, { fetchImpl: fetchImpl as any })
    expect(r1.ok).toBe(false)
    const r2 = await testWooCommerceConnection({ ...wooCfg, siteUrl: "  http://x.com" }, { fetchImpl: fetchImpl as any })
    expect((r2 as any).message).toMatch(/https/)
    expect(fetchImpl).not.toHaveBeenCalled()
    const ok = await testWooCommerceConnection({ ...wooCfg, siteUrl: "  https://x.com " }, { fetchImpl: (async () => json([])) as any })
    expect(ok.ok).toBe(true)
  })
})

describe("testShopifyConnection extra", () => {
  it.each([
    [403, /credentials rejected/],
    [404, /not found/],
    [500, /request failed \(500\)/],
  ])("maps %i", async (status, re) => {
    const r = await testShopifyConnection(shopifyCfg, { fetchImpl: (async () => json({}, status as number)) as any })
    noLeak(r)
    expect((r as any).message).toMatch(re)
  })

  it("rejects an invalid location id without any request", async () => {
    const fetchImpl = vi.fn()
    const r = await testShopifyConnection({ ...shopifyCfg, locationId: "abc" }, { fetchImpl: fetchImpl as any })
    expect((r as any).message).toBe("location ID is invalid")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("trims the location id and accepts a gid", async () => {
    const fetchImpl = vi.fn(async () => json({ data: { shop: { name: "D" }, location: { id: "x" } } }))
    const r = await testShopifyConnection({ ...shopifyCfg, locationId: " gid://shopify/Location/9 " }, { fetchImpl: fetchImpl as any })
    expect(r.ok).toBe(true)
  })

  it("words GraphQL errors without leaking", async () => {
    const r = await testShopifyConnection(shopifyCfg, {
      fetchImpl: (async () => json({ errors: [{ message: `denied ${TOKEN}` }] })) as any,
    })
    noLeak(r)
    expect((r as any).message).toBe("request invalid (check access scopes and location ID)")
  })

  it("reports persistent 429 as rate limiting", async () => {
    const r = await testShopifyConnection(shopifyCfg, { fetchImpl: (async () => json({}, 429)) as any })
    noLeak(r)
    expect((r as any).message).toMatch(/rate limiting/)
  })

  it("aborts the hung request on timeout", async () => {
    const cap: { signal?: AbortSignal } = {}
    const r = await testShopifyConnection(shopifyCfg, { fetchImpl: hangingFetch(cap) as any, timeoutMs: 20 })
    expect((r as any).message).toMatch(/timed out/i)
    expect(cap.signal?.aborted).toBe(true)
  })
})
