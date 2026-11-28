import {
  clampLimit,
  rankTrending,
  sumUnits,
} from "../../api/store/search/trending/helpers"

describe("clampLimit", () => {
  it.each([
    [0, 1],
    [99, 12],
    ["abc", 8],
    [undefined, 8],
    ["5", 5],
  ])("%j -> %j", (raw, expected) => {
    expect(clampLimit(raw)).toBe(expected)
  })
})

describe("sumUnits", () => {
  it("sums quantities per product, desc, skipping null products", () => {
    expect(
      sumUnits([
        { product_id: "a", quantity: 1 },
        { product_id: "b", quantity: 5 },
        { product_id: "a", quantity: 2 },
        { product_id: null, quantity: 9 },
      ])
    ).toEqual([
      { product_id: "b", quantity: 5 },
      { product_id: "a", quantity: 3 },
    ])
  })
})

describe("rankTrending", () => {
  const sold = [
    { product_id: "a", quantity: 1 },
    { product_id: "b", quantity: 4 },
    { product_id: "c", quantity: 2 },
  ]

  it("orders sold products by units", () => {
    expect(rankTrending(sold, new Set(["a", "b", "c"]), [], 8)).toEqual([
      "b",
      "c",
      "a",
    ])
  })

  it("fills with newest, no duplicates", () => {
    expect(
      rankTrending(sold, new Set(["a", "b", "c"]), ["a", "n1", "n2", "n3"], 5)
    ).toEqual(["b", "c", "a", "n1", "n2"])
  })

  it("returns newest when nothing sold", () => {
    expect(rankTrending([], new Set(), ["n1", "n2", "n3"], 2)).toEqual([
      "n1",
      "n2",
    ])
  })

  it("excludes ineligible (unpublished or hidden) sold products", () => {
    expect(rankTrending(sold, new Set(["a"]), ["n1"], 3)).toEqual(["a", "n1"])
  })
})
