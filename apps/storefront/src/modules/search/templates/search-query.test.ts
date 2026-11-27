import { describe, expect, it } from "vitest"
import {
  createSearchStateMapping,
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
  const m = createSearchStateMapping("product", () => "grid")

  it("maps query to q and keeps other refinements", () => {
    const route = m.stateToRoute({
      product: { query: "rose", page: 2, refinementList: { brand: ["Dior"] } },
    })
    expect(route).toEqual({
      q: "rose",
      page: 2,
      refinementList: { brand: ["Dior"] },
    })
  })

  it("maps q back to query", () => {
    expect(
      m.routeToState({ q: "rose", page: 2, view: "list" } as never)
    ).toEqual({ product: { query: "rose", page: 2 } })
  })
})
