import { MedusaError } from "@medusajs/framework/utils"
import { POST as hold } from "../[id]/hold/route"
import { POST as release } from "../[id]/release/route"
import { HoldOrderSchema, ReleaseOrderSchema } from "../middlewares"

const mockHoldRun = jest.fn()
const mockReleaseRun = jest.fn()
jest.mock("../../../../workflows/hold-order", () => ({
  holdOrderWorkflow: () => ({ run: mockHoldRun }),
}))
jest.mock("../../../../workflows/release-order", () => ({
  releaseOrderWorkflow: () => ({ run: mockReleaseRun }),
}))

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
const makeReq = (validatedBody?: unknown) =>
  ({ params: { id: "order_1" }, validatedBody, scope: {}, auth_context: { actor_id: "user_1" } }) as any

beforeEach(() => {
  mockHoldRun.mockReset()
  mockReleaseRun.mockReset()
})

describe("schemas", () => {
  it("empty or 256-char reason is 400", () => {
    expect(HoldOrderSchema.safeParse({ reason: "" }).success).toBe(false)
    expect(HoldOrderSchema.safeParse({ reason: "   " }).success).toBe(false)
    expect(HoldOrderSchema.safeParse({ reason: "a".repeat(256) }).success).toBe(false)
    expect(HoldOrderSchema.safeParse({ reason: "a".repeat(255) }).success).toBe(true)
  })
  it("unknown key is 400", () => {
    expect(HoldOrderSchema.safeParse({ reason: "x", extra: 1 }).success).toBe(false)
    expect(ReleaseOrderSchema.safeParse({ extra: 1 }).success).toBe(false)
    expect(ReleaseOrderSchema.safeParse({}).success).toBe(true)
  })
})

describe("hold and release routes", () => {
  it("success returns on_hold true/false", async () => {
    mockHoldRun.mockResolvedValue({ result: { order_id: "order_1", tag_id: "t" } })
    mockReleaseRun.mockResolvedValue({ result: { order_id: "order_1" } })
    const a = makeRes()
    await hold(makeReq({ reason: "Check" }), a)
    expect(a.statusCode).toBe(200)
    expect(a.payload).toEqual({ order_id: "order_1", on_hold: true })
    expect(mockHoldRun).toHaveBeenCalledWith({
      input: { order_id: "order_1", reason: "Check", user_id: "user_1" },
    })
    const b = makeRes()
    await release(makeReq({}), b)
    expect(b.payload).toEqual({ order_id: "order_1", on_hold: false })
    expect(mockReleaseRun).toHaveBeenCalledWith({ input: { order_id: "order_1", user_id: "user_1" } })
  })

  it("unknown order is 404 (NOT_FOUND propagates to the framework error handler)", async () => {
    mockHoldRun.mockRejectedValue(new MedusaError(MedusaError.Types.NOT_FOUND, "missing"))
    await expect(hold(makeReq({ reason: "x" }), makeRes())).rejects.toMatchObject({
      type: MedusaError.Types.NOT_FOUND,
    })
  })

  it("double hold second call is 400 (NOT_ALLOWED propagates to the framework error handler)", async () => {
    mockHoldRun
      .mockResolvedValueOnce({ result: {} })
      .mockRejectedValueOnce(new MedusaError(MedusaError.Types.NOT_ALLOWED, "already on hold"))
    await hold(makeReq({ reason: "x" }), makeRes())
    await expect(hold(makeReq({ reason: "x" }), makeRes())).rejects.toMatchObject({
      type: MedusaError.Types.NOT_ALLOWED,
    })
  })
})
