import { describe, expect, it } from "vitest"
import {
  applyViewToUrl,
  createStateMapping,
  type CatalogRoute,
  parseView,
  readViewFromSearch,
} from "./view-state"

describe("parseView", () => {
  it("only accepts list", () => {
    expect(parseView(undefined)).toBe("grid")
    expect(parseView("grid")).toBe("grid")
    expect(parseView("list")).toBe("list")
    expect(parseView("LIST")).toBe("grid")
    expect(parseView("x")).toBe("grid")
    expect(parseView(["list"])).toBe("grid")
  })
})

describe("readViewFromSearch", () => {
  it("reads the view param", () => {
    expect(readViewFromSearch("?view=list&page=2")).toBe("list")
    expect(readViewFromSearch("?view=nope")).toBe("grid")
    expect(readViewFromSearch("")).toBe("grid")
  })
})

describe("applyViewToUrl", () => {
  it("adds list and omits grid", () => {
    expect(applyViewToUrl("https://x.test/store?page=2", "list")).toBe(
      "https://x.test/store?page=2&view=list"
    )
    expect(
      applyViewToUrl("https://x.test/store?view=list&page=2", "grid")
    ).toBe("https://x.test/store?page=2")
    expect(applyViewToUrl("https://x.test/store?view=list", "grid")).toBe(
      "https://x.test/store"
    )
  })
})

describe("createStateMapping", () => {
  const index = "products"

  it("writes list into the route and omits grid", () => {
    let view: "grid" | "list" = "list"
    const mapping = createStateMapping(index, () => view)
    const uiState = { [index]: { page: 2, query: "oud" } }

    expect(mapping.stateToRoute(uiState)).toEqual({
      page: 2,
      query: "oud",
      view: "list",
    })
    view = "grid"
    expect(mapping.stateToRoute(uiState)).toEqual({ page: 2, query: "oud" })
  })

  it("drops view when reading the route back into state", () => {
    const mapping = createStateMapping(index, () => "grid")

    expect(mapping.routeToState({ query: "oud", view: "list" })).toEqual({
      [index]: { query: "oud" },
    })
    expect(mapping.routeToState({ view: "bogus" } as unknown as CatalogRoute)).toEqual({ [index]: {} })
  })
})
