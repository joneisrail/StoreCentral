import { callSellerHub, SellerHubError } from "../seller-hub-client"
import { GET, POST as create } from "../route"
import { POST as edit, DELETE as disconnect } from "../[id]/route"
import { POST as test } from "../[id]/test/route"
import { POST as link } from "../[id]/link/route"
import { GET as importPreview } from "../[id]/import-preview/route"
import { POST as runImport } from "../[id]/import/route"
import { GET as syncStatus } from "../[id]/sync-status/route"
import { CreateConnectionSchema, ImportSchema, SaveConnectionSchema, marketplaceConnectionMiddlewares } from "../middlewares"

jest.mock("../seller-hub-client", () => {
  const actual = jest.requireActual("../seller-hub-client")
  return { ...actual, callSellerHub: jest.fn() }
})
const mockRun = jest.fn()
jest.mock("../../../../workflows/create-marketplace-sales-channel", () => ({
  createMarketplaceSalesChannelWorkflow: () => ({ run: mockRun }),
}))
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
const makeReq = (id: string, validatedBody?: unknown) =>
  ({ params: { id }, validatedBody, scope: {} }) as any
const mockGraph = jest.fn()
const createReq = (body: Record<string, unknown>) =>
  ({ validatedBody: body, scope: { resolve: () => ({ graph: mockGraph }) } }) as any

beforeEach(() => {
  mocked.mockReset()
  mockRun.mockReset()
  mockGraph.mockReset()
  mockRun.mockResolvedValue({ result: { id: "sc_1", name: "Shop" } })
})

describe("schemas", () => {
  it("save rejects unknown keys and non-string values", () => {
    expect(SaveConnectionSchema.safeParse({ nope: "x" }).success).toBe(false)
    expect(SaveConnectionSchema.safeParse({ access_token: 5 }).success).toBe(false)
    expect(SaveConnectionSchema.safeParse({ sales_channel_id: "sc" }).success).toBe(false)
  })
  it("save does not accept display_name (ignored on edit); create still does", () => {
    expect(SaveConnectionSchema.safeParse({ display_name: "x" }).success).toBe(false)
    expect(
      CreateConnectionSchema.safeParse({ marketplace: "amazon", name: "A", display_name: "x" }).success
    ).toBe(true)
  })
  it("create with an unknown marketplace is 400 (schema rejects it)", () => {
    expect(CreateConnectionSchema.safeParse({ marketplace: "ebay", name: "x" }).success).toBe(false)
    expect(CreateConnectionSchema.safeParse({ marketplace: "shopify", name: "" }).success).toBe(false)
    expect(CreateConnectionSchema.safeParse({ marketplace: "amazon", name: "A" }).success).toBe(true)
  })
})

describe("auto_sync_price", () => {
  it("save accepts the flag alone, with credentials, and rejects non-booleans", () => {
    expect(SaveConnectionSchema.safeParse({ auto_sync_price: true }).success).toBe(true)
    expect(SaveConnectionSchema.safeParse({ auto_sync_price: false, access_token: "t" }).success).toBe(true)
    expect(SaveConnectionSchema.safeParse({ access_token: "t" }).success).toBe(true)
    expect(SaveConnectionSchema.safeParse({ auto_sync_price: "true" }).success).toBe(false)
    expect(SaveConnectionSchema.safeParse({ auto_sync_price: 1 }).success).toBe(false)
    expect(SaveConnectionSchema.safeParse({ auto_sync_price: true, nope: "x" }).success).toBe(false)
  })

  it("create does not take the flag (it defaults to false)", () => {
    expect(
      CreateConnectionSchema.safeParse({ marketplace: "amazon", name: "A", auto_sync_price: true }).success
    ).toBe(false)
  })

  it("a flag-only save forwards exactly the flag and nothing else", async () => {
    mocked.mockResolvedValue({ status: 200, body: { ok: true, connection: { auto_sync_price: true }, test: null } })
    const res = makeRes()
    await edit(makeReq("c1", { auto_sync_price: true }), res)
    expect(mocked).toHaveBeenCalledTimes(1)
    expect(mocked.mock.calls[0]!.slice(0, 3)).toEqual(["PUT", "/internal/connections/c1", { auto_sync_price: true }])
    expect(mocked.mock.calls[0]![3]).toBeUndefined()
    expect(res.payload.connection.auto_sync_price).toBe(true)
  })

  it("a false flag is forwarded (not dropped like a blank)", async () => {
    mocked.mockResolvedValue({ status: 200, body: { ok: true } })
    await edit(makeReq("c1", { auto_sync_price: false }), makeRes())
    expect(mocked.mock.calls[0]![2]).toEqual({ auto_sync_price: false })
  })

  it("credentials-only saves are unchanged (no flag key)", async () => {
    mocked.mockResolvedValue({ status: 200, body: { ok: true } })
    await edit(makeReq("c1", { access_token: "tok", webhook_secret: "" }), makeRes())
    expect(mocked).toHaveBeenCalledWith("PUT", "/internal/connections/c1", { access_token: "tok" }, { timeoutMs: 120_000 })
  })

  it("credentials plus the flag forward both with the long timeout", async () => {
    mocked.mockResolvedValue({ status: 200, body: { ok: true } })
    await edit(makeReq("c1", { access_token: "tok", auto_sync_price: true }), makeRes())
    expect(mocked).toHaveBeenCalledWith(
      "PUT",
      "/internal/connections/c1",
      { access_token: "tok", auto_sync_price: true },
      { timeoutMs: 120_000 }
    )
  })

  it("the list response carries the field through", async () => {
    mocked.mockResolvedValue({
      status: 200,
      body: { connections: [{ id: "a", sales_channel_id: "sc_1", auto_sync_price: true }] },
    })
    const res = makeRes()
    await GET({ query: { sales_channel_id: "sc_1" } } as any, res)
    expect(res.payload.connections[0].auto_sync_price).toBe(true)
  })
})

describe("attach to an existing sales channel", () => {
  const body = { marketplace: "shopify", sales_channel_id: "sc_9", shop_domain: "a.myshopify.com", access_token: "topsecret" }

  it("attach to existing channel succeeds without the workflow", async () => {
    mockGraph.mockResolvedValue({ data: [{ id: "sc_9", name: "Existing" }] })
    const connection = { id: "c1", status: "connected", sales_channel_id: "sc_9" }
    mocked.mockResolvedValue({ status: 200, body: { ok: true, connection, test: { ok: true } } })
    const res = makeRes()
    await create(createReq(body), res)
    expect(mockRun).not.toHaveBeenCalled()
    expect(mocked).toHaveBeenCalledWith(
      "POST",
      "/internal/connections",
      { marketplace: "shopify", sales_channel_id: "sc_9", shop_domain: "a.myshopify.com", access_token: "topsecret" },
      { timeoutMs: 120_000 }
    )
    expect(res.payload).toEqual({
      sales_channel: { id: "sc_9", name: "Existing" },
      connection,
      test: { ok: true },
      connection_status: "connected",
    })
    expect(JSON.stringify(res.payload)).not.toContain("topsecret")
  })

  it("unknown channel is 404 and seller-hub is not called", async () => {
    mockGraph.mockResolvedValue({ data: [] })
    const res = makeRes()
    await create(createReq(body), res)
    expect(res.statusCode).toBe(404)
    expect(res.payload.error).toBe("sales_channel_not_found")
    expect(mocked).not.toHaveBeenCalled()
  })

  it("an already-connected channel gets a clear 400", async () => {
    mockGraph.mockResolvedValue({ data: [{ id: "sc_9", name: "Existing" }] })
    mocked.mockResolvedValue({ status: 400, body: { error: "invalid_input", fields: ["sales_channel_id"] } })
    const res = makeRes()
    await create(createReq(body), res)
    expect(res.statusCode).toBe(400)
    expect(res.payload.message).toBe("This sales channel already has a marketplace connection.")
    expect(JSON.stringify(res.payload)).not.toContain("topsecret")
  })

  it("seller-hub down keeps the existing channel and reports unavailable", async () => {
    mockGraph.mockResolvedValue({ data: [{ id: "sc_9", name: "Existing" }] })
    mocked.mockRejectedValue(new SellerHubError(502, "Cannot reach seller-hub"))
    const res = makeRes()
    await create(createReq(body), res)
    expect(res.payload).toMatchObject({ sales_channel: { id: "sc_9", name: "Existing" }, connection: null, connection_status: "unavailable" })
    expect(res.payload.message).toContain("choose Connect to try again")
  })

  it("does not log bodies", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => {})
    )
    mockGraph.mockResolvedValue({ data: [{ id: "sc_9", name: "Existing" }] })
    mocked.mockRejectedValue(new Error("topsecret"))
    await create(createReq(body), makeRes())
    for (const s of spies) {
      expect(JSON.stringify(s.mock.calls)).not.toContain("topsecret")
      s.mockRestore()
    }
  })

  it("schema: both or neither of name and sales_channel_id is rejected", () => {
    expect(CreateConnectionSchema.safeParse({ marketplace: "shopify" }).success).toBe(false)
    expect(CreateConnectionSchema.safeParse({ marketplace: "shopify", name: "A", sales_channel_id: "sc" }).success).toBe(false)
    expect(CreateConnectionSchema.safeParse({ marketplace: "shopify", sales_channel_id: "sc" }).success).toBe(true)
  })

  it("schema: description and is_disabled need name", () => {
    expect(CreateConnectionSchema.safeParse({ marketplace: "shopify", sales_channel_id: "sc", description: "d" }).success).toBe(false)
    expect(CreateConnectionSchema.safeParse({ marketplace: "shopify", sales_channel_id: "sc", is_disabled: true }).success).toBe(false)
    expect(CreateConnectionSchema.safeParse({ marketplace: "shopify", name: "A", description: "d", is_disabled: true }).success).toBe(true)
  })
})

describe("create", () => {
  const body = { marketplace: "shopify", name: "Shop", shop_domain: "a.myshopify.com", access_token: "tok", webhook_secret: "" }

  it("create returns connected when seller-hub reports ok", async () => {
    const connection = { id: "c1", status: "connected", sales_channel_id: "sc_1" }
    mocked.mockResolvedValue({ status: 200, body: { ok: true, connection, test: { ok: true } } })
    const res = makeRes()
    await create(createReq(body), res)
    expect(mockRun).toHaveBeenCalledWith({ input: { name: "Shop", description: undefined, is_disabled: undefined } })
    expect(mocked).toHaveBeenCalledWith(
      "POST",
      "/internal/connections",
      { marketplace: "shopify", sales_channel_id: "sc_1", shop_domain: "a.myshopify.com", access_token: "tok" },
      { timeoutMs: 120_000 }
    )
    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({
      sales_channel: { id: "sc_1", name: "Shop" },
      connection,
      test: { ok: true },
      connection_status: "connected",
    })
  })

  it("create keeps the channel and returns error status when the test failed", async () => {
    mocked.mockResolvedValue({
      status: 200,
      body: { ok: false, connection: { id: "c1", status: "error" }, test: { ok: false, message: "Bad token" } },
    })
    const res = makeRes()
    await create(createReq(body), res)
    expect(res.payload.sales_channel).toEqual({ id: "sc_1", name: "Shop" })
    expect(res.payload.connection_status).toBe("error")
    expect(res.payload.test).toEqual({ ok: false, message: "Bad token" })
  })

  it("create reports invalid input as error and missing-only as disconnected", async () => {
    mocked.mockResolvedValueOnce({
      status: 200,
      body: { ok: false, error: "invalid_input", message: "Bad domain", input_problem: "invalid", fields: ["shop_domain"], connection: { id: "c1", status: "disconnected" }, test: null },
    })
    let res = makeRes()
    await create(createReq(body), res)
    expect(res.payload).toMatchObject({ connection_status: "error", message: "Bad domain", input_problem: "invalid", fields: ["shop_domain"] })

    mocked.mockResolvedValueOnce({
      status: 200,
      body: { ok: true, input_problem: "missing", fields: ["access_token"], connection: { id: "c1", status: "disconnected" }, test: null },
    })
    res = makeRes()
    await create(createReq(body), res)
    expect(res.payload).toMatchObject({ connection_status: "disconnected", input_problem: "missing", fields: ["access_token"] })
  })

  it("create does not forward a bare error code as the message", async () => {
    mocked.mockResolvedValueOnce({
      status: 200,
      body: { ok: false, error: "failed to start", connection: { id: "c1", status: "error" }, test: { ok: true } },
    })
    const res = makeRes()
    await create(createReq(body), res)
    expect(res.payload.connection_status).toBe("error")
    expect(res.payload.message).toBeUndefined()
  })

  it("create keeps the channel and returns unavailable when seller-hub is down", async () => {
    mocked.mockRejectedValue(new SellerHubError(502, "Cannot reach seller-hub"))
    const res = makeRes()
    await create(createReq(body), res)
    expect(res.statusCode).toBe(200)
    expect(res.payload).toMatchObject({
      sales_channel: { id: "sc_1", name: "Shop" },
      connection: null,
      test: null,
      connection_status: "unavailable",
    })
    expect(typeof res.payload.message).toBe("string")
  })

  it("create answers 400 without calling seller-hub when the channel cannot be created", async () => {
    mockRun.mockRejectedValue(new Error("boom tok"))
    const res = makeRes()
    await create(createReq(body), res)
    expect(res.statusCode).toBe(400)
    expect(JSON.stringify(res.payload)).not.toContain("tok")
    expect(mocked).not.toHaveBeenCalled()
  })

  it("request bodies are never logged", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => {})
    )
    mocked.mockRejectedValueOnce(new SellerHubError(502, "Cannot reach seller-hub"))
    await create(createReq({ ...body, access_token: "topsecret" }), makeRes())
    mocked.mockRejectedValueOnce(new Error("topsecret"))
    await edit(makeReq("c1", { access_token: "topsecret" }), makeRes())
    mocked.mockResolvedValueOnce({ status: 200, body: { ok: true, connection: {}, test: null } })
    await create(createReq({ ...body, access_token: "topsecret" }), makeRes())
    for (const s of spies) {
      expect(JSON.stringify(s.mock.calls)).not.toContain("topsecret")
      s.mockRestore()
    }
  })
})

describe("routes", () => {
  it("GET forwards the list", async () => {
    mocked.mockResolvedValue({ status: 200, body: { connections: [] } })
    const res = makeRes()
    await GET({ query: {} } as any, res)
    expect(mocked).toHaveBeenCalledWith("GET", "/internal/connections")
    expect(res.payload).toEqual({ connections: [] })
  })

  it("GET filters by sales_channel_id", async () => {
    mocked.mockResolvedValue({
      status: 200,
      body: { connections: [{ id: "a", sales_channel_id: "sc_1" }, { id: "b", sales_channel_id: "sc_2" }] },
    })
    const res = makeRes()
    await GET({ query: { sales_channel_id: "sc_2" } } as any, res)
    expect(res.payload).toEqual({ connections: [{ id: "b", sales_channel_id: "sc_2" }] })
  })

  it("edit drops blank strings and forwards as PUT", async () => {
    mocked.mockResolvedValue({ status: 200, body: { ok: true, connection: {} } })
    const res = makeRes()
    await edit(makeReq("c1", { shop_domain: "a.myshopify.com", access_token: "", webhook_secret: "" }), res)
    expect(mocked).toHaveBeenCalledWith("PUT", "/internal/connections/c1", { shop_domain: "a.myshopify.com" }, { timeoutMs: 120_000 })
    expect(res.statusCode).toBe(200)
  })

  it("edit passes 422 test_failed through unchanged", async () => {
    mocked.mockResolvedValue({ status: 422, body: { error: "test_failed", message: "Bad token" } })
    const res = makeRes()
    await edit(makeReq("c1", { consumer_secret: "topsecret" }), res)
    expect(res.statusCode).toBe(422)
    expect(res.payload).toEqual({ error: "test_failed", message: "Bad token" })
    expect(JSON.stringify(res.payload)).not.toContain("topsecret")
  })

  it("maps client errors to their status without secrets", async () => {
    mocked.mockRejectedValue(new SellerHubError(502, "Cannot reach seller-hub"))
    const res = makeRes()
    await edit(makeReq("c1", { access_token: "topsecret" }), res)
    expect(res.statusCode).toBe(502)
    expect(JSON.stringify(res.payload)).not.toContain("topsecret")
    expect(res.payload.message).toBe("Cannot reach seller-hub")
  })

  it("passes long timeouts for edit, link and test only", async () => {
    mocked.mockResolvedValue({ status: 200, body: { ok: true } })
    await edit(makeReq("c1", { shop_domain: "a.myshopify.com" }), makeRes())
    await link(makeReq("c1"), makeRes())
    await test(makeReq("c1"), makeRes())
    await disconnect(makeReq("c1"), makeRes())
    expect(mocked.mock.calls.map((c) => c[3])).toEqual([
      { timeoutMs: 120_000 },
      { timeoutMs: 120_000 },
      { timeoutMs: 30_000 },
      undefined,
    ])
  })

  it("delete, test and link forward by id", async () => {
    mocked.mockResolvedValue({ status: 200, body: { ok: true } })
    await disconnect(makeReq("c1"), makeRes())
    await test(makeReq("c2"), makeRes())
    await link(makeReq("c3"), makeRes())
    expect(mocked.mock.calls.map((c) => c.slice(0, 2))).toEqual([
      ["DELETE", "/internal/connections/c1"],
      ["POST", "/internal/connections/c2/test"],
      ["POST", "/internal/connections/c3/link"],
    ])
  })
})

describe("channel import", () => {
  it("ImportSchema accepts all or a bounded list of non-blank skus", () => {
    expect(ImportSchema.safeParse({ skus: "all" }).success).toBe(true)
    expect(ImportSchema.safeParse({ skus: ["A", " B "] }).data).toEqual({ skus: ["A", "B"] })
    expect(ImportSchema.safeParse({ skus: Array(500).fill("x") }).success).toBe(true)
  })
  it("ImportSchema rejects unknown keys, empty arrays, blanks, long entries and 501 items", () => {
    expect(ImportSchema.safeParse({ skus: "all", extra: 1 }).success).toBe(false)
    expect(ImportSchema.safeParse({}).success).toBe(false)
    expect(ImportSchema.safeParse({ skus: "some" }).success).toBe(false)
    expect(ImportSchema.safeParse({ skus: [] }).success).toBe(false)
    expect(ImportSchema.safeParse({ skus: ["A", "  "] }).success).toBe(false)
    expect(ImportSchema.safeParse({ skus: ["x".repeat(256)] }).success).toBe(false)
    expect(ImportSchema.safeParse({ skus: Array(501).fill("x") }).success).toBe(false)
  })
  it("registers the body schema for POST import", () => {
    expect(
      marketplaceConnectionMiddlewares.some(
        (m) => m.matcher === "/admin/marketplace-connections/:id/import" && m.method === "POST"
      )
    ).toBe(true)
  })
  it("preview is a GET to import-preview with a 120s timeout and no body", async () => {
    mocked.mockResolvedValue({ status: 200, body: { products: [] } })
    const res = makeRes()
    await importPreview(makeReq("c1"), res)
    expect(mocked).toHaveBeenCalledWith("GET", "/internal/connections/c1/import-preview", undefined, { timeoutMs: 120_000 })
    expect(res.payload).toEqual({ products: [] })
  })
  it("import is a POST forwarding the body with a 300s timeout", async () => {
    mocked.mockResolvedValue({ status: 200, body: { imported: 2 } })
    const res = makeRes()
    await runImport(makeReq("c 2", { skus: ["A", "B"] }), res)
    expect(mocked).toHaveBeenCalledWith("POST", "/internal/connections/c%202/import", { skus: ["A", "B"] }, { timeoutMs: 300_000 })
    expect(res.payload).toEqual({ imported: 2 })
  })
  it("passes seller-hub errors and statuses through", async () => {
    mocked.mockResolvedValue({ status: 409, body: { error: "busy" } })
    const r1 = makeRes()
    await runImport(makeReq("c1", { skus: "all" }), r1)
    expect(r1.statusCode).toBe(409)
    expect(r1.payload).toEqual({ error: "busy" })
    mocked.mockRejectedValue(new SellerHubError(502, "Cannot reach seller-hub"))
    const r2 = makeRes()
    await importPreview(makeReq("c1"), r2)
    expect(r2.statusCode).toBe(502)
    expect(r2.payload.message).toBe("Cannot reach seller-hub")
  })
})

describe("sync status", () => {
  it("is a GET to sync-status with a 15s timeout and no body", async () => {
    mocked.mockResolvedValue({ status: 200, body: { rows: [] } })
    const res = makeRes()
    await syncStatus(makeReq("c1"), res)
    expect(mocked).toHaveBeenCalledWith("GET", "/internal/connections/c1/sync-status", undefined, { timeoutMs: 15_000 })
    expect(res.payload).toEqual({ rows: [] })
  })
  it("encodes the connection id", async () => {
    mocked.mockResolvedValue({ status: 200, body: {} })
    await syncStatus(makeReq("c 2"), makeRes())
    expect(mocked).toHaveBeenCalledWith("GET", "/internal/connections/c%202/sync-status", undefined, { timeoutMs: 15_000 })
  })
  it("passes a seller-hub 404 body through and maps SellerHubError to 502", async () => {
    mocked.mockResolvedValue({ status: 404, body: { error: "not found" } })
    const r1 = makeRes()
    await syncStatus(makeReq("c1"), r1)
    expect(r1.statusCode).toBe(404)
    expect(r1.payload).toEqual({ error: "not found" })
    mocked.mockRejectedValue(new SellerHubError(502, "Cannot reach seller-hub"))
    const r2 = makeRes()
    await syncStatus(makeReq("c1"), r2)
    expect(r2.statusCode).toBe(502)
    expect(r2.payload.message).toBe("Cannot reach seller-hub")
  })
})
