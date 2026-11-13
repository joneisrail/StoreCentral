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
