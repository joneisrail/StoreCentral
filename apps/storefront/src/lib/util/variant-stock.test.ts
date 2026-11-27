import { describe, expect, it } from "vitest"
import { availabilityLabel, getAvailability } from "./variant-stock"

describe("getAvailability", () => {
  it("treats untracked inventory as in stock without a limit", () => {
    expect(getAvailability({ manage_inventory: false, allow_backorder: false, inventory_quantity: 0 })).toEqual({
      state: "in_stock",
      max: null,
    })
  })
  it("reports backorder when allowed", () => {
    expect(
      getAvailability({ manage_inventory: true, allow_backorder: true, inventory_quantity: 0 })
    ).toEqual({ state: "backorder", max: null })
  })
  it("uses the tracked quantity as the limit", () => {
    expect(
      getAvailability({ manage_inventory: true, allow_backorder: false, inventory_quantity: 4 })
    ).toEqual({ state: "in_stock", max: 4 })
  })
  it("is out of stock at zero or missing quantity", () => {
    const out = { state: "out_of_stock", max: 0 }
    expect(
      getAvailability({ manage_inventory: true, allow_backorder: false, inventory_quantity: 0 })
    ).toEqual(out)
    expect(getAvailability({ manage_inventory: true, allow_backorder: false })).toEqual(out)
  })
  it("is out of stock when there is no variant", () => {
    expect(getAvailability(undefined)).toEqual({ state: "out_of_stock", max: 0 })
  })
})

describe("availabilityLabel", () => {
  it("labels each state", () => {
    expect(availabilityLabel({ state: "in_stock", max: null })).toBe("In stock")
    expect(availabilityLabel({ state: "backorder", max: null })).toBe("Available to order")
    expect(availabilityLabel({ state: "out_of_stock", max: 0 })).toBe("Out of stock")
  })
})
