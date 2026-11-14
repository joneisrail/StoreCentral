import { MedusaError } from "@medusajs/framework/utils"
import { POST as voidLabel } from "../[id]/void-label/route"
import { VoidOrderLabelSchema } from "../middlewares"

const mockRun = jest.fn()
jest.mock("../../../../workflows/void-order-label", () => ({
  voidOrderLabelWorkflow: () => ({ run: mockRun }),
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
const req = () => ({ params: { id: "order_1" }, validatedBody: {}, scope: {}, auth_context: { actor_id: "user_1" } }) as any

beforeEach(() => mockRun.mockReset())

describe("void-label route", () => {
  it("body must be an empty strict object", () => {
    expect(VoidOrderLabelSchema.safeParse({}).success).toBe(true)
    expect(VoidOrderLabelSchema.safeParse({ extra: 1 }).success).toBe(false)
  })

  it("returns 200 with the workflow result", async () => {
    const result = { order_id: "order_1", voided: [{ fulfillment_id: "ful_1",  }] }
    mockRun.mockResolvedValue({ result })
    const res = makeRes()
    await voidLabel(req(), res)
    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual(result)
    expect(mockRun).toHaveBeenCalledWith({ input: { order_id: "order_1" } })
  })

  it("propagates NOT_FOUND and NOT_ALLOWED to the framework error handler", async () => {
    mockRun.mockRejectedValueOnce(new MedusaError(MedusaError.Types.NOT_FOUND, "missing"))
    await expect(voidLabel(req(), makeRes())).rejects.toMatchObject({ type: MedusaError.Types.NOT_FOUND })
    mockRun.mockRejectedValueOnce(new MedusaError(MedusaError.Types.NOT_ALLOWED, "nope"))
    await expect(voidLabel(req(), makeRes())).rejects.toMatchObject({ type: MedusaError.Types.NOT_ALLOWED })
  })
})
