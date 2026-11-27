import { describe, expect, it } from "vitest"
import { navReducer } from "./combobox-nav"

const s = (active: number, count: number) => ({ active, count })

describe("navReducer", () => {
  it("moves next and wraps through the input (-1)", () => {
    expect(navReducer(s(-1, 3), "next")).toEqual(s(0, 3))
    expect(navReducer(s(1, 3), "next")).toEqual(s(2, 3))
    expect(navReducer(s(2, 3), "next")).toEqual(s(-1, 3))
  })

  it("moves prev and wraps to the last item", () => {
    expect(navReducer(s(1, 3), "prev")).toEqual(s(0, 3))
    expect(navReducer(s(0, 3), "prev")).toEqual(s(-1, 3))
    expect(navReducer(s(-1, 3), "prev")).toEqual(s(2, 3))
  })

  it("first, last and reset", () => {
    expect(navReducer(s(2, 3), "first")).toEqual(s(0, 3))
    expect(navReducer(s(0, 3), "last")).toEqual(s(2, 3))
    expect(navReducer(s(1, 3), "reset")).toEqual(s(-1, 3))
  })

  it("keeps active at -1 when there are no items", () => {
    for (const a of ["next", "prev", "first", "last", "reset"] as const) {
      expect(navReducer(s(-1, 0), a)).toEqual(s(-1, 0))
    }
  })

  it("clamps active when the count changes", () => {
    expect(navReducer(s(4, 5), { type: "count", count: 2 })).toEqual(s(1, 2))
    expect(navReducer(s(2, 5), { type: "count", count: 0 })).toEqual(s(-1, 0))
    expect(navReducer(s(1, 5), { type: "count", count: 9 })).toEqual(s(1, 9))
    expect(navReducer(s(-1, 5), { type: "count", count: 2 })).toEqual(s(-1, 2))
  })
})
