import { MedusaError } from "@medusajs/framework/utils"
import { POST as markShipped } from "../[id]/mark-shipped/route"
import { MarkShippedSchema } from "../middlewares"

const mockRun = jest.fn()
jest.mock("../../../../workflows/mark-order-shipped", () => ({
  markOrderShippedWorkflow: () => ({ run: mockRun }),
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

beforeEach(() => mockRun.mockReset())

describe("MarkShippedSchema", () => {
  const ok = { carrier: "UPS", tracking_number: "1Z999" }
  it("accepts the minimal and the full body", () => {
    expect(MarkShippedSchema.safeParse(ok).success).toBe(true)
    expect(
      MarkShippedSchema.safeParse({
        ...ok,
        tracking_url: "https://t.example/1",
        shipped_at: "2026-02-02T10:00:00Z",
        no_notification: true,
        location_id: "sloc_1",
      }).success
    ).toBe(true)
  })
  it("rejects empty or oversized carrier and tracking number", () => {
    expect(MarkShippedSchema.safeParse({ ...ok, tracking_number: "" }).success).toBe(false)
    expect(MarkShippedSchema.safeParse({ ...ok, tracking_number: "   " }).success).toBe(false)
    expect(MarkShippedSchema.safeParse({ ...ok, carrier: "" }).success).toBe(false)
    expect(MarkShippedSchema.safeParse({ ...ok, carrier: "a".repeat(101) }).success).toBe(false)
    expect(MarkShippedSchema.safeParse({ ...ok, tracking_number: "a".repeat(101) }).success).toBe(false)
    expect(MarkShippedSchema.safeParse({ ...ok, tracking_number: "a".repeat(100) }).success).toBe(true)
  })
  it("rejects a bad url, a bad date and unknown keys", () => {
    expect(MarkShippedSchema.safeParse({ ...ok, tracking_url: "not a url" }).success).toBe(false)
    expect(MarkShippedSchema.safeParse({ ...ok, shipped_at: "yesterday" }).success).toBe(false)
    expect(MarkShippedSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false)
  })
})

describe("POST /admin/orders/:id/mark-shipped", () => {
  it("runs the workflow with the actor and returns the ids", async () => {
    mockRun.mockResolvedValue({ result: { order_id: "order_1", fulfillment_id: "ful_1" } })
    const res = makeRes()
    await markShipped(makeReq({ carrier: "UPS", tracking_number: "1Z", no_notification: true }), res)
    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({ order_id: "order_1", fulfillment_id: "ful_1" })
    expect(mockRun).toHaveBeenCalledWith({
      input: { order_id: "order_1", carrier: "UPS", tracking_number: "1Z", no_notification: true, user_id: "user_1" },
    })
  })

  it("propagates workflow errors to the framework error handler", async () => {
    mockRun.mockRejectedValue(new MedusaError(MedusaError.Types.NOT_ALLOWED, "held"))
    await expect(markShipped(makeReq({ carrier: "UPS", tracking_number: "1Z" }), makeRes())).rejects.toMatchObject({
      type: MedusaError.Types.NOT_ALLOWED,
    })
  })

  it("turns a lock-acquisition failure into a clear 409", async () => {
    mockRun.mockRejectedValue(new Error('Failed to acquire lock for key "order_1"'))
    await expect(markShipped(makeReq({ carrier: "UPS", tracking_number: "1Z" }), makeRes())).rejects.toMatchObject({
      type: MedusaError.Types.CONFLICT,
      message: expect.stringMatching(/already being marked shipped/),
    })
  })
})
