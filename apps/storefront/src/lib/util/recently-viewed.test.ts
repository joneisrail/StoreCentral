// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  RECENT_CAP,
  RECENT_KEY,
  addRecent,
  parseRecent,
  readRecent,
  writeRecent,
} from "./recently-viewed"

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe("parseRecent", () => {
  it("returns [] for null, corrupt json and non-arrays", () => {
    expect(parseRecent(null)).toEqual([])
    expect(parseRecent("{nope")).toEqual([])
    expect(parseRecent("{}")).toEqual([])
  })

  it("drops non-strings", () => {
    expect(parseRecent(JSON.stringify(["a", 1, null, "b"]))).toEqual(["a", "b"])
  })
})

describe("addRecent", () => {
  it("moves an existing id to the front", () => {
    expect(addRecent(["a", "b", "c"], "c")).toEqual(["c", "a", "b"])
  })

  it("caps the list", () => {
    const list = Array.from({ length: RECENT_CAP }, (_, i) => `p${i}`)
    const next = addRecent(list, "new")
    expect(next).toHaveLength(RECENT_CAP)
    expect(next[0]).toBe("new")
  })
})

describe("readRecent / writeRecent", () => {
  it("round-trips through localStorage", () => {
    writeRecent(["a", "b"])
    expect(window.localStorage.getItem(RECENT_KEY)).toBe('["a","b"]')
    expect(readRecent()).toEqual(["a", "b"])
  })

  it("does not throw when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied")
    })
    expect(readRecent()).toEqual([])
    expect(() => writeRecent(["a"])).not.toThrow()
  })
})
