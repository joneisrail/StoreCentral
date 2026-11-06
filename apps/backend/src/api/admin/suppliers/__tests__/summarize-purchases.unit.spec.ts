import { summarizePurchases } from "../summarize-purchases"

type P = Parameters<typeof summarizePurchases>[0][number]

const purchase = (overrides: Partial<P> = {}): P => ({
  status: "ordered",
  shipping_cost: 5,
  tax: 0,
  other_cost: 0,
  items: [{ quantity: 10, quantity_received: 0, unit_cost: 2.5 }],
  ...overrides,
})

describe("summarizePurchases", () => {
  it("returns zeros and empty counts for no purchases", () => {
    expect(summarizePurchases([])).toEqual({
      counts: {},
      total_ordered: 0,
      total_received: 0,
      outstanding: 0,
    })
  })

  it("sums an ordered purchase with nothing received", () => {
    expect(summarizePurchases([purchase()])).toEqual({
      counts: { ordered: 1 },
      total_ordered: 30,
      total_received: 0,
      outstanding: 25,
    })
  })

  it("accounts for received quantity", () => {
    const result = summarizePurchases([
      purchase({
        status: "partially_received",
        items: [{ quantity: 10, quantity_received: 4, unit_cost: 2.5 }],
      }),
    ])
    expect(result).toEqual({
      counts: { partially_received: 1 },
      total_ordered: 30,
      total_received: 10,
      outstanding: 15,
    })
  })

  it("counts draft and cancelled purchases but excludes them from money", () => {
    const result = summarizePurchases([
      purchase({ status: "draft" }),
      purchase({ status: "cancelled" }),
      purchase(),
    ])
    expect(result.counts).toEqual({ draft: 1, cancelled: 1, ordered: 1 })
    expect(result.total_ordered).toBe(30)
    expect(result.total_received).toBe(0)
    expect(result.outstanding).toBe(25)
  })

  it("rounds to 2 decimals", () => {
    const result = summarizePurchases([
      purchase({
        shipping_cost: 0,
        items: [{ quantity: 3, quantity_received: 0, unit_cost: 0.1 }],
      }),
    ])
    expect(result.total_ordered).toBe(0.3)
    expect(result.outstanding).toBe(0.3)
  })

  it("rounds total_received at the boundary", () => {
    const result = summarizePurchases([
      purchase({
        shipping_cost: 0,
        status: "received",
        items: [{ quantity: 3, quantity_received: 3, unit_cost: 0.1 }],
      }),
    ])
    expect(result.total_received).toBe(0.3)
    expect(result.outstanding).toBe(0)
  })
})
