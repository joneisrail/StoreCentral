// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, userEvent } from "../../../test/render"
import StoreTemplate from "./index"

vi.mock("@lib/search-client", () => ({
  PRODUCT_INDEX_NAME: "product",
  searchClient: {},
  priceAttribute: (field: string, currency: string) => `${field}_${currency}`,
}))
vi.mock("react-instantsearch", () => ({
  InstantSearch: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Configure: () => null,
  useInstantSearch: () => ({ results: { nbHits: 5 } }),
}))
vi.mock("instantsearch.js/es/lib/routers", () => ({ history: () => ({}) }))
vi.mock("@modules/store/components/store-hits", () => ({
  default: ({ view }: { view: string }) => <div data-testid="hits" data-view={view} />,
}))
vi.mock("@modules/store/components/store-refinements", () => ({ default: () => null }))
vi.mock("@modules/store/components/store-refinements/current-refinements", () => ({ default: () => null }))
vi.mock("@modules/store/components/store-refinements/filter-drawer", () => ({ default: () => null }))
vi.mock("@modules/store/components/store-refinements/sort-select", () => ({ default: () => null }))
vi.mock("@modules/store/components/store-search-box", () => ({ default: () => null }))
vi.mock("@modules/common/components/localized-client-link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

beforeEach(() => window.history.replaceState(null, "", "/store"))
afterEach(cleanup)

const hitsView = () =>
  document.querySelector("[data-testid=hits]")?.getAttribute("data-view")
const toggle = (label: string) =>
  document.querySelector(`[aria-label="${label}"]`) as HTMLElement

describe("StoreTemplate view wiring", () => {
  it("renders the hits inside the space-reserving results column", () => {
    render(<StoreTemplate currencyCode="usd" />)
    const col = document.querySelector("[data-testid=results-column]")
    expect(col?.querySelector("[data-testid=hits]")).not.toBeNull()
  })

  it("writes and removes view in the URL when toggled", async () => {
    const spy = vi.spyOn(window.history, "replaceState")
    render(<StoreTemplate currencyCode="usd" />)

    await userEvent.click(toggle("List view"))
    expect(hitsView()).toBe("list")
    expect(spy.mock.calls.at(-1)?.[2]).toContain("view=list")
    expect(window.location.search).toBe("?view=list")

    await userEvent.click(toggle("Grid view"))
    expect(hitsView()).toBe("grid")
    expect(window.location.search).toBe("")
    spy.mockRestore()
  })

  it("restores the view from the URL on popstate", async () => {
    render(<StoreTemplate currencyCode="usd" />)
    expect(hitsView()).toBe("grid")

    window.history.replaceState(null, "", "/store?view=list")
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"))
    })
    expect(hitsView()).toBe("list")
  })

  it("starts in list view when the URL asks for it", () => {
    window.history.replaceState(null, "", "/store?view=list")
    render(<StoreTemplate currencyCode="usd" />)
    expect(hitsView()).toBe("list")
  })
})
