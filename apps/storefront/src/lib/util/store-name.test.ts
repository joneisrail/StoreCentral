import { describe, expect, it } from "vitest"
import { getStoreName } from "./store-name"

describe("getStoreName", () => {
  it("falls back to Store when unset", () => {
    expect(getStoreName({})).toBe("Store")
  })

  it("falls back to Store when blank", () => {
    expect(getStoreName({ NEXT_PUBLIC_STORE_NAME: "   " })).toBe("Store")
  })

  it("trims the configured name", () => {
    expect(getStoreName({ NEXT_PUBLIC_STORE_NAME: "  Fragrance House " })).toBe(
      "Fragrance House"
    )
  })
})
