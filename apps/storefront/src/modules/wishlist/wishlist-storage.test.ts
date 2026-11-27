import { describe, expect, it } from "vitest"
import {
  WISHLIST_KEY,
  parseWishlist,
  serializeWishlist,
  toggleWishlist,
} from "./wishlist-storage"

describe("wishlist storage", () => {
  it("uses the sc-wishlist key", () => {
    expect(WISHLIST_KEY).toBe("sc-wishlist")
  })

  it("gives an empty list for null, corrupt or non-array JSON", () => {
    expect(parseWishlist(null)).toEqual([])
    expect(parseWishlist("{oops")).toEqual([])
    expect(parseWishlist('{"a":1}')).toEqual([])
  })

  it("drops non-strings and duplicates", () => {
    expect(parseWishlist('["a",1,null,"b","a",{"x":1}]')).toEqual(["a", "b"])
  })

  it("caps at 200 keeping the newest", () => {
    const ids = Array.from({ length: 205 }, (_, i) => `id${i}`)
    const parsed = parseWishlist(JSON.stringify(ids))
    expect(parsed).toHaveLength(200)
    expect(parsed[0]).toBe("id5")
    expect(parsed[199]).toBe("id204")
  })

  it("toggles an id on and off", () => {
    expect(toggleWishlist(["a"], "b")).toEqual(["a", "b"])
    expect(toggleWishlist(["a", "b"], "a")).toEqual(["b"])
  })

  it("drops the oldest when toggling past 200", () => {
    const ids = Array.from({ length: 200 }, (_, i) => `id${i}`)
    const next = toggleWishlist(ids, "new")
    expect(next).toHaveLength(200)
    expect(next[0]).toBe("id1")
    expect(next[199]).toBe("new")
  })

  it("round-trips through serialize and parse", () => {
    expect(parseWishlist(serializeWishlist(["a", "b"]))).toEqual(["a", "b"])
  })
})
