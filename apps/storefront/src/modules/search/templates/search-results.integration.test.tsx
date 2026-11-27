// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render } from "../../../test/render"
import SearchResults from "./search-results"

const requests: { params?: Record<string, unknown> }[] = []

vi.mock("@lib/data/track-search", () => ({ trackSearch: () => {} }))
vi.mock("@lib/search-client", () => ({
  PRODUCT_INDEX_NAME: "product",
  priceAttribute: (field: string, currency: string) => `${field}_${currency}`,
  searchClient: {
    search: async (
      queries: { indexName: string; params?: Record<string, unknown> }[]
    ) => {
      requests.push(...queries)
      return {
        results: queries.map(() => ({
          hits: [],
          nbHits: 0,
          page: 0,
          nbPages: 0,
          hitsPerPage: 12,
          processingTimeMS: 1,
          exhaustiveNbHits: true,
          query: "",
          params: "",
        })),
      }
    },
  },
}))
vi.mock("@modules/store/components/store-hits", () => ({ default: () => null }))
vi.mock("@modules/store/components/store-refinements", () => ({ default: () => null }))
vi.mock("@modules/store/components/store-refinements/current-refinements", () => ({ default: () => null }))
vi.mock("@modules/store/components/store-refinements/filter-drawer", () => ({ default: () => null }))
vi.mock("@modules/store/components/store-refinements/sort-select", () => ({ default: () => null }))
vi.mock("@modules/common/components/localized-client-link", () => ({
  default: () => null,
}))

afterEach(cleanup)

describe("SearchResults with a real InstantSearch", () => {
  it("sends the page query to the search client", async () => {
    window.history.replaceState(null, "", "/us/search?q=khamrah")
    render(<SearchResults query="khamrah" currencyCode="usd" />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(requests.length).toBeGreaterThan(0)
    expect(requests.some((r) => r.params?.query === "khamrah")).toBe(true)
  })
})
