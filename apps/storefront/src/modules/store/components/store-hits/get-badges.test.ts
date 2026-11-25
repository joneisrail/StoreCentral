import { describe, expect, it, vi } from "vitest"
vi.mock("server-only", () => ({}))

import { getBadges } from "./get-badges"

const now = new Date("2026-11-26T12:00:00Z")
const daysAgo = (days: number) =>
  new Date(now.getTime() - days * 86_400_000).toISOString()

describe("getBadges", () => {
  it("returns at most two badges in Sold out, Sale, New order", () => {
    const badges = getBadges(
      {
        in_stock: false,
        on_sale_eur: true,
        created_at: daysAgo(1),
      },
      "eur",
      now
    )
    expect(badges).toEqual(["Sold out", "Sale"])
  })

  it("does not flag Sold out when in_stock is missing", () => {
    expect(getBadges({ created_at: daysAgo(100) }, "eur", now)).toEqual([])
    expect(getBadges({ in_stock: true }, "eur", now)).toEqual([])
  })

  it("treats exactly 30 days as New and 31 days as not", () => {
    expect(getBadges({ created_at: daysAgo(30) }, "eur", now)).toEqual(["New"])
    expect(getBadges({ created_at: daysAgo(31) }, "eur", now)).toEqual([])
  })

  it("does not mark a future date as New", () => {
    expect(getBadges({ created_at: daysAgo(-1) }, "eur", now)).toEqual([])
  })

  it("ignores a sale in another currency", () => {
    expect(getBadges({ on_sale_usd: true }, "eur", now)).toEqual([])
    expect(getBadges({ on_sale_usd: true }, "usd", now)).toEqual(["Sale"])
  })

  it("ignores an invalid created_at", () => {
    expect(getBadges({ created_at: "nope" }, "eur", now)).toEqual([])
  })
})
