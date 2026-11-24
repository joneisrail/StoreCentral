import { callSellerHub, SellerHubError } from "../../marketplace-connections/seller-hub-client"
import { GET, POST, DELETE } from "../route"
import { POST as testSettings } from "../test/route"
import { AmazonSettingsSchema, amazonSettingsMiddlewares } from "../middlewares"

jest.mock("../../marketplace-connections/seller-hub-client", () => {
  const actual = jest.requireActual("../../marketplace-connections/seller-hub-client")
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
const makeReq = (validatedBody?: unknown) => ({ validatedBody, scope: {} }) as any

beforeEach(() => mocked.mockReset())

describe("AmazonSettingsSchema", () => {
  it("accepts the six snake_case keys, trims, and allows an empty object", () => {
    expect(AmazonSettingsSchema.safeParse({}).success).toBe(true)
    const parsed = AmazonSettingsSchema.safeParse({
      aws_region: " us-east-1 ",
      sqs_queue_url: "u",
      lwa_client_id: "i",
      aws_access_key_id: "k",
      aws_secret_access_key: "s",
      lwa_client_secret: "",
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data!.aws_region).toBe("us-east-1")
  })
  it("rejects unknown keys, camelCase, non-strings and values over 2048", () => {
    expect(AmazonSettingsSchema.safeParse({ nope: "x" }).success).toBe(false)
    expect(AmazonSettingsSchema.safeParse({ awsRegion: "x" }).success).toBe(false)
    expect(AmazonSettingsSchema.safeParse({ aws_region: 5 }).success).toBe(false)
    expect(AmazonSettingsSchema.safeParse({ lwa_client_secret: "x".repeat(2049) }).success).toBe(false)
    expect(AmazonSettingsSchema.safeParse({ lwa_client_secret: "x".repeat(2048) }).success).toBe(true)
  })
  it("registers the schema for POST on both paths", () => {
    for (const matcher of ["/admin/amazon-settings", "/admin/amazon-settings/test"]) {
      expect(amazonSettingsMiddlewares.some((m) => m.matcher === matcher && m.method === "POST")).toBe(true)
    }
  })
})

describe("routes", () => {
  it("GET forwards with the default timeout", async () => {
    mocked.mockResolvedValue({ status: 200, body: { aws_region: "us-east-1" } })
    const res = makeRes()
    await GET(makeReq(), res)
    expect(mocked).toHaveBeenCalledWith("GET", "/internal/amazon-settings")
    expect(res.payload).toEqual({ aws_region: "us-east-1" })
  })
  it("POST forwards the body exactly with the default timeout", async () => {
    mocked.mockResolvedValue({ status: 200, body: { ok: true } })
    const body = { aws_region: "eu-west-1", lwa_client_secret: "topsecret", aws_access_key_id: "" }
    await POST(makeReq(body), makeRes())
    expect(mocked).toHaveBeenCalledWith("POST", "/internal/amazon-settings", body)
  })
  it("DELETE forwards", async () => {
    mocked.mockResolvedValue({ status: 200, body: { ok: true } })
    await DELETE(makeReq(), makeRes())
    expect(mocked).toHaveBeenCalledWith("DELETE", "/internal/amazon-settings")
  })
  it("test POST forwards the body with a 15s timeout", async () => {
    mocked.mockResolvedValue({ status: 200, body: { ok: true } })
    const body = { sqs_queue_url: "https://q" }
    await testSettings(makeReq(body), makeRes())
    expect(mocked).toHaveBeenCalledWith("POST", "/internal/amazon-settings/test", body, { timeoutMs: 15_000 })
  })
  it("passes a seller-hub 422 through unchanged", async () => {
    const payload = { error: "invalid_input", fields: ["aws_region"], kind: "invalid" }
    mocked.mockResolvedValue({ status: 422, body: payload })
    const r1 = makeRes()
    await POST(makeReq({ aws_region: "x" }), r1)
    expect(r1.statusCode).toBe(422)
    expect(r1.payload).toEqual(payload)
    const r2 = makeRes()
    await testSettings(makeReq({ aws_region: "x" }), r2)
    expect(r2.statusCode).toBe(422)
    expect(r2.payload).toEqual(payload)
  })
  it("maps SellerHubError to 502 without echoing the body or logging it", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => {})
    )
    mocked.mockRejectedValue(new SellerHubError(502, "Cannot reach seller-hub"))
    const res = makeRes()
    await POST(makeReq({ lwa_client_secret: "topsecret" }), res)
    expect(res.statusCode).toBe(502)
    expect(res.payload.message).toBe("Cannot reach seller-hub")
    expect(JSON.stringify(res.payload)).not.toContain("topsecret")
    for (const s of spies) {
      expect(JSON.stringify(s.mock.calls)).not.toContain("topsecret")
      s.mockRestore()
    }
  })
})
