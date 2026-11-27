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
const { trackSearch } = vi.hoisted(() => ({ trackSearch: vi.fn() }))
vi.mock("@lib/data/track-search", () => ({ trackSearch }))

// "lattafa" has 44 hits, 40 of them Lattafa; with a brand filter applied the
// main query answers 40. Every other query has none.
const LATTAFA_HITS = 44
const LATTAFA_BRAND_HITS = 40
const hasFacetFilter = (params?: Record<string, unknown>) => {
  const filters = params?.facetFilters
  return Array.isArray(filters) && filters.flat().length > 0
}
const answer = (params?: Record<string, unknown>) => {
  const query = typeof params?.query === "string" ? params.query : ""
  const nbHits =
    query === "lattafa"
      ? hasFacetFilter(params)
        ? LATTAFA_BRAND_HITS
        : LATTAFA_HITS
      : 0
  return {
    hits: [],
    nbHits,
    page: 0,
    nbPages: nbHits ? 1 : 0,
    hitsPerPage: 12,
    processingTimeMS: 1,
    exhaustiveNbHits: true,
    query,
    params: "",
    facets: nbHits
      ? { brand: { Lattafa: LATTAFA_BRAND_HITS, Dior: LATTAFA_HITS - LATTAFA_BRAND_HITS } }
      : {},
  }
}
vi.mock("@lib/search-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lib/search-client")>()),
  searchClient: {
    search: async (
      queries: { indexName: string; params?: Record<string, unknown> }[]
    ) => {
      requests.push(...queries)
      await new Promise((r) => setTimeout(r, 300))
      return { results: queries.map((q) => answer(q.params)) }
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

afterEach(() => {
  cleanup()
  trackSearch.mockClear()
})

// Polls (no fixed sleep) until the assertion holds, flushing React updates.
const eventually = (assertion: () => void) =>
  vi.waitFor(
    async () => {
      await act(async () => {})
      assertion()
    },
    { timeout: 3000, interval: 20 }
  )

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
  it("tracks the unfiltered hit count once, and not again after a refinement", async () => {
    window.history.replaceState(null, "", "/us/search?q=lattafa")
    const { container } = render(
      <SearchResults query="lattafa" currencyCode="usd" />
    )

    await eventually(() => expect(trackSearch).toHaveBeenCalledTimes(1))
    expect(trackSearch).toHaveBeenCalledWith("lattafa", LATTAFA_HITS)

    const lattafa = await (async () => {
      let box: HTMLInputElement | null = null
      await eventually(() => {
        box = container.querySelector<HTMLInputElement>(
          'input[type="checkbox"][value="Lattafa"]'
        )
        expect(box).not.toBeNull()
      })
      return box as unknown as HTMLInputElement
    })()
    await act(async () => {
      lattafa.click()
    })

    await eventually(() =>
      expect(
        container.querySelector('[data-testid="result-count"]')?.textContent
      ).toBe(`${LATTAFA_BRAND_HITS} products`)
    )
    expect(
      requests.some(
        (r) => r.params?.query === "lattafa" && hasFacetFilter(r.params)
      )
    ).toBe(true)
    expect(trackSearch).toHaveBeenCalledTimes(1)
  })
})
