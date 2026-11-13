import { callSellerHub, SellerHubError } from "../seller-hub-client"
import { GET } from "../route"
import { POST as save, DELETE as disconnect } from "../[marketplace]/route"
import { POST as test } from "../[marketplace]/test/route"
import { POST as link } from "../[marketplace]/link/route"
import { SaveConnectionSchema } from "../middlewares"

jest.mock("../seller-hub-client", () => {
  const actual = jest.requireActual("../seller-hub-client")
  return { ...actual, callSellerHub: jest.fn() }
})
const mocked = callSellerHub as jest.Mock

const makeRes = () => {
  const res: any = { statusCode: 200, payload: undefined }
  res.status = (c: number) => {
    res.statusCode = c
    return res
  }
  res.json = (b: unknown) => {
    res.payload = b
    return res
  }
  return res
}
const makeReq = (marketplace: string, validatedBody?: unknown) =>
  ({ params: { marketplace }, validatedBody }) as any

beforeEach(() => mocked.mockReset())

describe("SaveConnectionSchema", () => {
  it("rejects unknown keys and non-string values", () => {
    expect(SaveConnectionSchema.safeParse({ nope: "x" }).success).toBe(false)
    expect(SaveConnectionSchema.safeParse({ access_token: 5 }).success).toBe(false)
  })
  it("trims strings", () => {
    expect(SaveConnectionSchema.parse({ shop_domain: "  a.myshopify.com " })).toEqual({
      shop_domain: "a.myshopify.com",
    })
  })
})

describe("routes", () => {
  it("GET forwards the list", async () => {
    mocked.mockResolvedValue({ status: 200, body: { connections: [] } })
    const res = makeRes()
    await GET({} as any, res)
    expect(mocked).toHaveBeenCalledWith("GET", "/internal/connections")
    expect(res.payload).toEqual({ connections: [] })
  })

  it("save drops blank strings and forwards as PUT", async () => {
    mocked.mockResolvedValue({ status: 200, body: { ok: true, connection: {} } })
    const res = makeRes()
    await save(
      makeReq("shopify", { shop_domain: "a.myshopify.com", access_token: "", webhook_secret: "" }),
      res
    )
    expect(mocked).toHaveBeenCalledWith("PUT", "/internal/connections/shopify", {
      shop_domain: "a.myshopify.com",
    }, { timeoutMs: 120_000 })
    expect(res.statusCode).toBe(200)
  })

  it("amazon is 400 and never reaches seller-hub", async () => {
    for (const handler of [save, disconnect, test, link]) {
      const res = makeRes()
      await handler(makeReq("amazon", {}), res)
      expect(res.statusCode).toBe(400)
    }
    expect(mocked).not.toHaveBeenCalled()
  })

  it("passes a 422 test_failed message through", async () => {
    mocked.mockResolvedValue({ status: 422, body: { error: "test_failed", message: "Bad token" } })
    const res = makeRes()
    await save(
      makeReq("woocommerce", { site_url: "https://x.com", consumer_secret: "topsecret" }),
      res
    )
    expect(res.statusCode).toBe(422)
    expect(res.payload).toEqual({ error: "test_failed", message: "Bad token" })
    expect(JSON.stringify(res.payload)).not.toContain("topsecret")
  })

  it("maps client errors to their status without secrets", async () => {
    mocked.mockRejectedValue(new SellerHubError(502, "Cannot reach seller-hub"))
    const res = makeRes()
    await save(makeReq("shopify", { access_token: "topsecret" }), res)
    expect(res.statusCode).toBe(502)
    expect(JSON.stringify(res.payload)).not.toContain("topsecret")
    expect(res.payload.message).toBe("Cannot reach seller-hub")
  })

  it("passes long timeouts for save, link and test only", async () => {
    mocked.mockResolvedValue({ status: 200, body: { ok: true } })
    await save(makeReq("shopify", { shop_domain: "a.myshopify.com" }), makeRes())
    await link(makeReq("shopify"), makeRes())
    await test(makeReq("shopify"), makeRes())
    await disconnect(makeReq("shopify"), makeRes())
    expect(mocked.mock.calls.map((c) => c[3])).toEqual([
      { timeoutMs: 120_000 },
      { timeoutMs: 120_000 },
      { timeoutMs: 30_000 },
      undefined,
    ])
  })

  it("delete, test and link forward", async () => {
    mocked.mockResolvedValue({ status: 200, body: { ok: true } })
    await disconnect(makeReq("shopify"), makeRes())
    await test(makeReq("woocommerce"), makeRes())
    await link(makeReq("shopify"), makeRes())
    expect(mocked.mock.calls.map((c) => c.slice(0, 2))).toEqual([
      ["DELETE", "/internal/connections/shopify"],
      ["POST", "/internal/connections/woocommerce/test"],
      ["POST", "/internal/connections/shopify/link"],
    ])
  })
})
