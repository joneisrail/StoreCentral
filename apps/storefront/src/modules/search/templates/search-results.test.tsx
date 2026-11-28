// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "../../../test/render"
import SearchResults from "./search-results"

const state: { current: Record<string, unknown> } = { current: {} }
const refinements: { current: unknown[] } = { current: [] }
const trackSearch = vi.fn()

vi.mock("@lib/data/track-search", () => ({
  trackSearch: (...args: unknown[]) => trackSearch(...args),
}))
vi.mock("@lib/search-client", () => ({
  PRODUCT_INDEX_NAME: "product",
  searchClient: {},
  priceAttribute: (field: string, currency: string) => `${field}_${currency}`,
}))
vi.mock("react-instantsearch", () => ({
  InstantSearch: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Configure: () => null,
  useInstantSearch: () => state.current,
  useCurrentRefinements: () => ({ items: refinements.current }),
}))
vi.mock("instantsearch.js/es/lib/routers", () => ({ history: () => ({}) }))
vi.mock("@modules/store/components/store-hits", () => ({
  default: () => <div data-testid="hits" />,
}))
vi.mock("@modules/store/components/store-refinements", () => ({ default: () => null }))
vi.mock("@modules/store/components/store-refinements/current-refinements", () => ({ default: () => null }))
vi.mock("@modules/store/components/store-refinements/filter-drawer", () => ({ default: () => null }))
vi.mock("@modules/store/components/store-refinements/sort-select", () => ({ default: () => null }))
vi.mock("@modules/common/components/localized-client-link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const settled = (query: string, nbHits: number, extra = {}) => ({
  status: "idle",
  results: { query, nbHits, _state: {}, ...extra },
})

const ui = (q: string, popular: string[] | null = null) => (
  <SearchResults query={q} currencyCode="usd" popularSearches={popular} />
)

beforeEach(() => {
  trackSearch.mockClear()
  refinements.current = []
  state.current = settled("rose", 4)
})
afterEach(cleanup)

describe("SearchResults", () => {
  it("wraps the results in the space reserver until settled", () => {
    state.current = { status: "loading", results: { __isArtificial: true } }
    const { container, rerender } = render(ui("rose"))
    const col = () =>
      container.querySelector("[data-testid=results-column]") as HTMLElement
    expect(col().className).toContain("min-h-[")
    state.current = settled("rose", 0)
    rerender(ui("rose"))
    expect(col().className).not.toContain("min-h-")
  })

  it("renders the query as text, not markup", () => {
    const { container } = render(ui("<b>x</b>"))
    const h1 = container.querySelector("h1")!
    expect(h1.textContent).toBe("Results for “<b>x</b>”")
    expect(h1.querySelector("b")).toBeNull()
  })

  it("shows the hint and popular links when nothing matches", () => {
    state.current = settled("zzzz", 0)
    const { container } = render(ui("zzzz", ["Dior", "Oud & Rose"]))
    expect(container.textContent).toContain("No fragrances found for “zzzz”.")
    expect(container.textContent).toContain(
      "Check the spelling or try a broader term such as a brand or a note."
    )
    const hrefs = Array.from(container.querySelectorAll("[data-testid=search-popular] a")).map(
      (a) => a.getAttribute("href")
    )
    expect(hrefs).toEqual(["/search?q=Dior", "/search?q=Oud%20%26%20Rose"])
    expect(container.querySelector("[data-testid=hits]")).toBeNull()
  })

  it("omits popular links when unavailable", () => {
    state.current = settled("zzzz", 0)
    const { container } = render(ui("zzzz", null))
    expect(container.querySelector("[data-testid=search-popular]")).toBeNull()
  })

  it("shows fixed error text and never the error message", () => {
    state.current = { status: "error", error: new Error("secret"), results: undefined }
    const { container } = render(ui("rose"))
    expect(container.textContent).toContain(
      "Search is unavailable right now. Please try again."
    )
    expect(container.textContent).not.toContain("secret")
    expect(trackSearch).not.toHaveBeenCalled()
  })

  it("tracks once per query after settling, even with 0 hits", () => {
    state.current = settled("zzzz", 0)
    render(ui("zzzz"))
    expect(trackSearch).toHaveBeenCalledTimes(1)
    expect(trackSearch).toHaveBeenCalledWith("zzzz", 0)
  })

  it("does not track while loading or for short queries", () => {
    state.current = { status: "loading", results: { query: "rose", nbHits: 4 } }
    render(ui("rose"))
    cleanup()
    state.current = {
      status: "idle",
      results: { query: "rose", nbHits: 4, __isArtificial: true },
    }
    render(ui("rose"))
    cleanup()
    state.current = settled("ab", 3)
    render(ui("ab"))
    expect(trackSearch).not.toHaveBeenCalled()
  })

  it("does not re-track on re-render or filter change, but tracks a new query", () => {
    const view = render(ui("rose"))
    expect(trackSearch).toHaveBeenCalledTimes(1)
    expect(trackSearch).toHaveBeenLastCalledWith("rose", 4)

    view.rerender(ui("rose"))
    state.current = settled("rose", 2) // filter narrowed the hits
    view.rerender(ui("rose"))
    expect(trackSearch).toHaveBeenCalledTimes(1)

    state.current = settled("oud", 7)
    view.rerender(ui("oud"))
    expect(trackSearch).toHaveBeenCalledTimes(2)
    expect(trackSearch).toHaveBeenLastCalledWith("oud", 7)
  })

  it("does not track a refined first load; tracks the unfiltered count once cleared", () => {
    refinements.current = [{ attribute: "brand" }]
    state.current = settled("rose", 2)
    const view = render(ui("rose"))
    expect(trackSearch).not.toHaveBeenCalled()

    refinements.current = []
    state.current = settled("rose", 9)
    view.rerender(ui("rose"))
    expect(trackSearch).toHaveBeenCalledTimes(1)
    expect(trackSearch).toHaveBeenCalledWith("rose", 9)

    refinements.current = [{ attribute: "brand" }]
    state.current = settled("rose", 0)
    view.rerender(ui("rose"))
    refinements.current = []
    view.rerender(ui("rose"))
    expect(trackSearch).toHaveBeenCalledTimes(1)
  })

  it("shows a filter-specific empty state when refinements zero the hits", () => {
    refinements.current = [{ attribute: "brand" }]
    state.current = settled("rose", 0)
    const { container } = render(ui("rose", ["Dior"]))
    expect(container.textContent).toContain("No fragrances match these filters.")
    expect(container.textContent).toContain("Try removing a filter.")
    expect(container.textContent).not.toContain("No fragrances found")
    expect(container.querySelector("[data-testid=search-popular]")).toBeNull()
  })

  it("waits for results whose own state is unrefined, even if the UI already is", () => {
    state.current = settled("rose", 2, { _state: { facetsRefinements: { brand: ["Dior"] } } })
    const view = render(ui("rose"))
    expect(trackSearch).not.toHaveBeenCalled()

    state.current = settled("rose", 9)
    view.rerender(ui("rose"))
    expect(trackSearch).toHaveBeenCalledTimes(1)
    expect(trackSearch).toHaveBeenCalledWith("rose", 9)
  })

  it("does not track a stale result set from another query", () => {
    state.current = settled("oud", 5)
    render(ui("rose"))
    expect(trackSearch).not.toHaveBeenCalled()
  })
})
