import { describe, expect, it } from "vitest"
import {
  createSearchStateMapping,
  isUnrefinedState,
  MAX_QUERY_LENGTH,
  normalizeQuery,
} from "./search-query"

describe("normalizeQuery", () => {
  it("trims, takes the first of repeated params, and caps the length", () => {
    expect(normalizeQuery("  dior  ")).toBe("dior")
    expect(normalizeQuery(["a", "b"])).toBe("a")
    expect(normalizeQuery(undefined)).toBe("")
    expect(normalizeQuery("   ")).toBe("")
    expect(normalizeQuery("x".repeat(500))).toHaveLength(MAX_QUERY_LENGTH)
  })
})

describe("createSearchStateMapping", () => {
  const m = createSearchStateMapping("product", () => "grid", () => "rose")

  it("re-adds the page query as q and keeps other refinements", () => {
    expect(
      m.stateToRoute({
        product: { page: 2, refinementList: { brand: ["Dior"] } },
      })
    ).toEqual({ q: "rose", page: 2, refinementList: { brand: ["Dior"] } })
  })

  it("drops q and view when reading the route back", () => {
    expect(
      m.routeToState({ q: "rose", page: 2, view: "list" } as never)
    ).toEqual({ product: { page: 2 } })
  })
})

describe("isUnrefinedState", () => {
  it("is true for empty and missing refinement keys", () => {
    expect(isUnrefinedState({})).toBe(true)
    expect(isUnrefinedState({ facetsRefinements: { brand: [] } })).toBe(true)
    expect(isUnrefinedState({ numericRefinements: { p: {} }, tagRefinements: [] })).toBe(true)
  })

  it("is false when any refinement is present", () => {
    expect(isUnrefinedState({ facetsRefinements: { brand: ["Dior"] } })).toBe(false)
    expect(isUnrefinedState({ facetsExcludes: { brand: ["Dior"] } })).toBe(false)
    expect(isUnrefinedState({ disjunctiveFacetsRefinements: { g: ["m"] } })).toBe(false)
    expect(isUnrefinedState({ hierarchicalFacetsRefinements: { c: ["a"] } })).toBe(false)
    expect(
      isUnrefinedState({ numericRefinements: { min_price_usd: { ">=": [10] } } })
    ).toBe(false)
    expect(isUnrefinedState({ tagRefinements: ["x"] })).toBe(false)
  })

  it("is false when the state is absent", () => {
    expect(isUnrefinedState(undefined)).toBe(false)
  })
})
