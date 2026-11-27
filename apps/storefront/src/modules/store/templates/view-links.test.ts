import { describe, expect, it } from "vitest"

import { gridClasses, viewHref, viewHrefs } from "./view-links"

describe("gridClasses", () => {
  it("is a single column for the list view", () => {
    expect(gridClasses("list")).toContain("grid-cols-1")
    expect(gridClasses("list")).not.toContain("small:grid-cols-3")
  })

  it("is the multi column grid for grid", () => {
    expect(gridClasses("grid")).toContain("grid-cols-2")
    expect(gridClasses("grid")).toContain("medium:grid-cols-4")
  })
})

describe("viewHref", () => {
  it("omits view for grid", () => {
    expect(viewHref("/categories/men", {}, "grid")).toBe("/categories/men")
  })

  it("sets view=list for list", () => {
    expect(viewHref("/categories/men", {}, "list")).toBe(
      "/categories/men?view=list"
    )
  })

  it("keeps sortBy and page", () => {
    expect(
      viewHref("/collections/a", { sortBy: "price_asc", page: "2" }, "list")
    ).toBe("/collections/a?sortBy=price_asc&page=2&view=list")
  })

  it("drops an existing view when going back to grid", () => {
    expect(
      viewHref("/collections/a", { sortBy: "price_asc", view: "list" }, "grid")
    ).toBe("/collections/a?sortBy=price_asc")
  })

  it("keeps repeated params", () => {
    expect(
      viewHref("/c", { optionValueIds: ["a", "b"] }, "list")
    ).toBe("/c?optionValueIds=a&optionValueIds=b&view=list")
  })

  it("treats an unknown view value as grid", () => {
    expect(viewHref("/c", { view: "bogus" }, "bogus" as never)).toBe("/c")
  })
})

describe("viewHrefs", () => {
  it("builds both hrefs", () => {
    expect(viewHrefs("/c", { page: "3" })).toEqual({
      grid: "/c?page=3",
      list: "/c?page=3&view=list",
    })
  })
})
