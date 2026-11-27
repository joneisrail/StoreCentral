// @vitest-environment jsdom
import { RefinementList } from "react-instantsearch"
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render } from "../../../test/render"
import SearchResults from "./search-results"

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 800))
  })

const requests: { params?: Record<string, unknown> }[] = []

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/us/search",
  useParams: () => ({ countryCode: "us" }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@lib/data/track-search", () => ({ trackSearch: () => {} }))
vi.mock("@lib/search-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lib/search-client")>()),
  searchClient: {
    search: async (
      queries: { indexName: string; params?: Record<string, unknown> }[]
    ) => {
      requests.push(...queries)
      await new Promise((r) => setTimeout(r, 300))
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
vi.mock("@modules/common/components/localized-client-link", () => ({
  default: () => null,
}))

vi.mock("@modules/store/components/store-refinements/current-refinements", () => ({ default: () => null }))
vi.mock("@modules/store/components/store-refinements/filter-drawer", () => ({ default: () => null }))

// Mounts the brand facet so the URL's refinement reaches InstantSearch, as the
// real filter drawer does.
vi.mock("@modules/store/components/store-refinements", () => ({
  default: () => (
    <div hidden>
      <RefinementList attribute="brand" />
    </div>
  ),
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

  it("shows exactly one query-specific empty state at zero hits", async () => {
    window.history.replaceState(null, "", "/us/search?q=zzzxqj")
    const { container } = render(
      <SearchResults query="zzzxqj" currencyCode="usd" popularSearches={["Dior"]} />
    )
    await settle()
    const text = container.textContent ?? ""

    expect(text).toContain("No fragrances found for “zzzxqj”.")
    expect(text).not.toContain("0 products")
    expect(text).toContain(
      "Check the spelling or try a broader term such as a brand or a note."
    )
    expect(text).not.toContain("No products matched these filters")
  })

  it("shows the filter-specific empty state when a refinement zeroes the hits", async () => {
    window.history.replaceState(
      null,
      "",
      "/us/search?q=zzzxqj&refinementList%5Bbrand%5D%5B0%5D=Dior"
    )
    const { container } = render(
      <SearchResults query="zzzxqj" currencyCode="usd" />
    )
    await settle()
    const text = container.textContent ?? ""

    expect(text).toContain("No fragrances match these filters.")
    expect(text).toContain("Try removing a filter.")
    expect(text).not.toContain("No products matched these filters")
  })
})
