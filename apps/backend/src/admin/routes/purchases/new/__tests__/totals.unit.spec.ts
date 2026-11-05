import { calculateTotals } from "../totals"

describe("calculateTotals", () => {
  it("sums quantity * unit_cost and adds shipping, tax and other cost", () => {
    expect(
      calculateTotals(
        [
          { quantity: 2, unit_cost: 10.25 },
          { quantity: 3, unit_cost: 4 },
        ],
        { shipping_cost: 5, tax: 2.5, other_cost: 1.25 }
      )
    ).toEqual({ subtotal: 32.5, total: 41.25 })
  })

  it("rounds to 2 decimals", () => {
    expect(
      calculateTotals([{ quantity: 3, unit_cost: 0.1 }], {
        shipping_cost: 0.2,
        tax: 0,
        other_cost: 0,
      })
    ).toEqual({ subtotal: 0.3, total: 0.5 })
  })

  it("returns zeros for no items", () => {
    expect(
      calculateTotals([], { shipping_cost: 0, tax: 0, other_cost: 0 })
    ).toEqual({ subtotal: 0, total: 0 })
  })
})
