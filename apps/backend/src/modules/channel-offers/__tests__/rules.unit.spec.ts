import { deduct, resplitPool, splitEqually, trimToTotal } from "../rules"

describe("channel stock rules", () => {
  const ids = ["a", "b", "c"]

  it("splits 7 over three channels", () => {
    expect(splitEqually(7, ids)).toEqual({ a: 3, b: 2, c: 2 })
  })
  it("splits 2 over three channels", () => {
    expect(splitEqually(2, ids)).toEqual({ a: 1, b: 1, c: 0 })
  })
  it("splits 0 into zeros", () => {
    expect(splitEqually(0, ids)).toEqual({ a: 0, b: 0, c: 0 })
  })
  it("returns {} for no channels", () => {
    expect(splitEqually(5, [])).toEqual({})
  })
  it("resplits the pool", () => {
    expect(resplitPool({ a: 8, b: 10, c: 10 }, ids)).toEqual({ a: 10, b: 9, c: 9 })
  })
  it("deducts and never goes below 0", () => {
    expect(deduct({ a: 5, b: 2 }, "a", 2)).toEqual({ a: 3, b: 2 })
    expect(deduct({ a: 1, b: 2 }, "a", 5)).toEqual({ a: 0, b: 2 })
  })
  it("trims the biggest channel first", () => {
    expect(trimToTotal({ a: 5, b: 3, c: 3 }, 8, ids)).toEqual({
      stocks: { a: 2, b: 3, c: 3 },
      trimmed: { a: 3 },
    })
  })
  it("leaves stocks unchanged when sum <= total", () => {
    expect(trimToTotal({ a: 1, b: 2 }, 10)).toEqual({ stocks: { a: 1, b: 2 }, trimmed: {} })
  })
})
