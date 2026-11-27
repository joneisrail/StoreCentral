// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  RECENT_SEARCHES_KEY,
  addRecentSearch,
  clearRecentSearches,
  getRecentSearches,
  removeRecentSearch,
} from "./recent-searches"

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe("recent searches", () => {
  it("adds newest first and returns the list", () => {
    addRecentSearch("lattafa")
    expect(addRecentSearch("khamrah")).toEqual(["khamrah", "lattafa"])
    expect(getRecentSearches()).toEqual(["khamrah", "lattafa"])
    expect(RECENT_SEARCHES_KEY).toBe("sc-recent-searches")
  })

  it("dedupes case-insensitively and moves the entry to the front", () => {
    addRecentSearch("Oud")
    addRecentSearch("vanilla")
    expect(addRecentSearch("OUD")).toEqual(["OUD", "vanilla"])
  })

  it("caps at 8", () => {
    for (let i = 1; i <= 10; i++) addRecentSearch(`query ${i}`)
    const list = getRecentSearches()
    expect(list).toHaveLength(8)
    expect(list[0]).toBe("query 10")
    expect(list[7]).toBe("query 3")
  })

  it("ignores short, blank and over-long queries and trims", () => {
    expect(addRecentSearch("a")).toEqual([])
    expect(addRecentSearch("   ")).toEqual([])
    expect(addRecentSearch("")).toEqual([])
    expect(addRecentSearch("x".repeat(61))).toEqual([])
    expect(addRecentSearch("  oud  ")).toEqual(["oud"])
    expect(addRecentSearch("x".repeat(60))).toHaveLength(2)
  })

  it("removes case-insensitively and clears", () => {
    addRecentSearch("oud")
    addRecentSearch("musk")
    expect(removeRecentSearch("OUD")).toEqual(["musk"])
    clearRecentSearches()
    expect(getRecentSearches()).toEqual([])
  })

  it("survives corrupt stored data", () => {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, "{nope")
    expect(getRecentSearches()).toEqual([])
    window.localStorage.setItem(
      RECENT_SEARCHES_KEY,
      JSON.stringify(["ok", 1, null, "a"])
    )
    expect(getRecentSearches()).toEqual(["ok"])
  })

  it("never throws when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota")
    })
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied")
    })
    expect(getRecentSearches()).toEqual([])
    expect(addRecentSearch("oud")).toEqual(["oud"])
    expect(removeRecentSearch("oud")).toEqual([])
    expect(() => clearRecentSearches()).not.toThrow()
  })
})
