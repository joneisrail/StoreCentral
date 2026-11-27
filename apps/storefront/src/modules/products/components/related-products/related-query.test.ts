import { describe, expect, it } from "vitest"
import { buildRelatedQuery } from "./related-query"

const brand = {
  id: "cat_brand",
  parent_category: { handle: "brands" },
}
const dept = { id: "cat_dept", parent_category: { handle: "women" } }

describe("buildRelatedQuery", () => {
  it("prefers the brand category", () => {
    expect(
      buildRelatedQuery({
        categories: [dept, brand],
        collection_id: "col_1",
      } as never)
    ).toEqual({ category_id: ["cat_brand"] })
  })

  it("falls back to the first non-brand category", () => {
    expect(
      buildRelatedQuery({ categories: [dept], collection_id: "col_1" } as never)
    ).toEqual({ category_id: ["cat_dept"] })
  })

  it("falls back to the collection", () => {
    expect(
      buildRelatedQuery({ categories: [], collection_id: "col_1" } as never)
    ).toEqual({ collection_id: ["col_1"] })
  })

  it("returns an empty object when nothing applies", () => {
    expect(buildRelatedQuery({} as never)).toEqual({})
  })
})
