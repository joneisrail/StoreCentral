import { describe, expect, it, vi } from "vitest"
vi.mock("server-only", () => ({}))

import { hitPriceLabels } from "./price"

describe("hitPriceLabels", () => {
  it("returns null price when the hit has no min price", () => {
    expect(hitPriceLabels({}, "usd")).toEqual({
      priceLabel: null,
      originalPriceLabel: null,
    })
  })

  it("formats a single price", () => {
    const r = hitPriceLabels({ min_price_usd: 10, max_price_usd: 10 }, "usd")
    expect(r.priceLabel).toContain("$10.00")
    expect(r.originalPriceLabel).toBeNull()
  })

  it("formats a range", () => {
    const r = hitPriceLabels({ min_price_usd: 10, max_price_usd: 25 }, "usd")
    expect(r.priceLabel).toMatch(/ - /)
    expect(r.originalPriceLabel).toBeNull()
  })

  it("returns the original price when on sale and not a range", () => {
    const r = hitPriceLabels(
      {
        min_price_usd: 8,
        max_price_usd: 8,
        original_price_usd: 10,
        on_sale_usd: true,
      },
      "usd"
    )
    expect(r.priceLabel).toContain("$8.00")
    expect(r.originalPriceLabel).toContain("$10.00")
  })
})
