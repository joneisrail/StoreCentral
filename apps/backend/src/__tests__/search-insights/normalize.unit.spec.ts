import { normalizeQuery } from "../../modules/search-insights/normalize"

describe("normalizeQuery", () => {
  it.each([
    ["  Lattafa  ", "lattafa"],
    ["Oud   Wood", "oud wood"],
    ["Hermès", "hermès"],
    ["ＬＡＴＴＡＦＡ", "lattafa"],
    ["abc", "abc"],
    ["!!a", "!!a"],
  ])("%j -> %j", (raw, expected) => {
    expect(normalizeQuery(raw)).toBe(expected)
  })

  it.each([["ab"], ["  a  "], [""], ["!!!"], ["... ---"], ["x".repeat(61)]])(
    "%j -> null",
    (raw) => {
      expect(normalizeQuery(raw)).toBeNull()
    }
  )

  it("accepts exactly 60 characters", () => {
    expect(normalizeQuery("x".repeat(60))).toBe("x".repeat(60))
  })
})
