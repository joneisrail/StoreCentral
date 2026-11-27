import { describe, expect, it, vi } from "vitest"

vi.mock("@lib/search-client", () => ({
  searchClient: {
    search: vi.fn(async () => ({ results: [{ hits: [{ objectID: "x" }] }] })),
    searchForFacetValues: vi.fn(),
    clearCache: vi.fn(),
  },
}))

import { searchClient } from "@lib/search-client"
import { overlaySearchClient } from "./overlay-client"
import {
  facetValues,
  refinementHref,
  resultSections,
  searchHref,
  suggestionSections,
  type ProductHit,
} from "./rows"

describe("search rows", () => {
  it("encodes the query into the /search link", () => {
    expect(searchHref("rose & oud")).toBe("/search?q=rose%20%26%20oud")
  })

  it("links a facet value to the filtered /store listing", () => {
    const url = new URL(refinementHref("brand", "Maison & Co"), "http://x")
    expect(url.pathname).toBe("/store")
    expect(url.searchParams.get("refinementList[brand][0]")).toBe("Maison & Co")
  })

  it("ranks facet values containing the query first, then by count", () => {
    const facets = [
      {
        name: "brand",
        data: { Alpha: 9, "Rose House": 1, Beta: 5, Gamma: 3, Empty: 0 },
      },
    ]
    expect(facetValues(facets, "brand", "rose")).toEqual([
      "Rose House",
      "Alpha",
      "Beta",
    ])
    expect(facetValues(facets, "category", "rose")).toEqual([])
    expect(facetValues(undefined, "brand", "rose")).toEqual([])
  })

  it("drops suggestion sections without data", () => {
    const sections = suggestionSections("s", {
      recent: [],
      popular: null,
      trending: [{ id: "t", title: "T", handle: "t", thumbnail: null }],
    })
    expect(sections.map((s) => s.key)).toEqual(["trending"])
    expect(sections[0].rows[0]).toMatchObject({ href: "/products/t" })
  })

  it("orders result sections and gives every row a unique id", () => {
    const hit = { objectID: "1", title: "A", handle: "a", thumbnail: null }
    const sections = resultSections("s", {
      query: "a",
      hits: [hit as ProductHit],
      facets: [{ name: "brand", data: { A: 1 } }],
    })
    expect(sections.map((s) => s.key)).toEqual(["product", "brand", "all"])
    const ids = sections.flatMap((s) => s.rows.map((r) => r.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect(sections.at(-1)?.rows[0]).toMatchObject({ href: "/search?q=a" })
  })
})

describe("overlaySearchClient", () => {
  it("answers a blank query without a request", async () => {
    const { results } = await overlaySearchClient.search([
      { indexName: "product", params: { query: "  ", hitsPerPage: 8 } },
    ])
    expect(searchClient.search).not.toHaveBeenCalled()
    expect(results[0]).toMatchObject({ hits: [], nbHits: 0 })
  })

  it("forwards a real query to the shared client", async () => {
    await overlaySearchClient.search([
      { indexName: "product", params: { query: "rose" } },
    ])
    expect(searchClient.search).toHaveBeenCalledTimes(1)
  })
})
