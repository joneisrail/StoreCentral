import { describe, expect, it } from "vitest"

import { getChannelColor } from "./channel-color"

const COLORS = ["blue", "green", "orange", "purple", "red", "grey"]

describe("getChannelColor", () => {
  it("is stable and returns a known colour", () => {
    expect(getChannelColor("Amazon")).toBe(getChannelColor("Amazon"))
    expect(COLORS).toContain(getChannelColor("Amazon"))
  })

  it("is case-insensitive and trims", () => {
    expect(getChannelColor("  EBAY ")).toBe(getChannelColor("ebay"))
  })

  it("handles empty names", () => {
    expect(COLORS).toContain(getChannelColor(""))
  })

  it("spreads different names across colours", () => {
    const names = [
      "amazon",
      "ebay",
      "etsy",
      "walmart",
      "shopify",
      "web",
      "tiktok",
      "pos",
    ]
    expect(new Set(names.map(getChannelColor)).size).toBeGreaterThan(2)
  })
})
