import { describe, expect, it } from "vitest"
import { hasVoidableLabel } from "./void-label"

const label = (extra: Record<string, unknown> = {}) => ({
  id: "ful",
  data: { easypost_shipment_id: "shp_1" },
  ...extra,
})

describe("hasVoidableLabel", () => {
  it("is true for an unshipped label only", () => {
    expect(hasVoidableLabel([label()])).toBe(true)
  })

  it("is false with no label or no fulfillments", () => {
    expect(hasVoidableLabel([label({ data: {} })])).toBe(false)
    expect(hasVoidableLabel([])).toBe(false)
    expect(hasVoidableLabel(null)).toBe(false)
  })

  it("is false when any live fulfillment is shipped or delivered", () => {
    expect(
      hasVoidableLabel([label(), label({ id: "b", shipped_at: "2026-01-01" })])
    ).toBe(false)
    expect(
      hasVoidableLabel([
        label(),
        label({ id: "b", delivered_at: "2026-01-01" }),
      ])
    ).toBe(false)
  })

  it("ignores canceled fulfillments", () => {
    expect(
      hasVoidableLabel([
        label(),
        label({
          id: "b",
          shipped_at: "2026-01-01",
          canceled_at: "2026-01-02",
        }),
      ])
    ).toBe(true)
    expect(hasVoidableLabel([label({ canceled_at: "2026-01-02" })])).toBe(false)
  })
})
