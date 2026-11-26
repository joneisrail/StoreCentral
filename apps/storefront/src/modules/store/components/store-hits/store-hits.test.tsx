// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, userEvent } from "../../../../test/render"
import StoreHits from "./index"

const setIndexUiState = vi.fn()
let indexUiState: Record<string, unknown> = {}

vi.mock("react-instantsearch", () => ({
  useHits: () => ({ items: [] }),
  useInstantSearch: () => ({
    status: "idle",
    error: undefined,
    indexUiState,
    setIndexUiState,
  }),
}))
vi.mock("@lib/hooks/use-search-settled", () => ({
  default: () => ({ isSearching: false, hasNoResultsYet: false }),
}))
vi.mock("./pagination", () => ({ default: () => null }))
vi.mock("./catalog-card", () => ({ default: () => null }))
vi.mock("@modules/skeletons/templates/skeleton-product-grid", () => ({
  default: () => null,
}))

beforeEach(() => {
  setIndexUiState.mockReset()
  indexUiState = {}
})
afterEach(cleanup)

const clear = () =>
  document.querySelector("[data-testid=no-products-clear]") as HTMLElement

const reset = () => {
  const updater = setIndexUiState.mock.calls[0][0] as (
    prev: Record<string, unknown>
  ) => Record<string, unknown>
  return updater
}

describe("StoreHits empty state", () => {
  it("shows the message and a Clear all that drops filters, query and page", async () => {
    indexUiState = { query: "zzz", page: 9 }
    render(<StoreHits hitsPerPage={12} currencyCode="usd" />)

    expect(document.querySelector("[data-testid=no-products]")?.textContent).toBe(
      "No products matched these filters."
    )
    await userEvent.click(clear())

    expect(
      reset()({
        query: "zzz",
        page: 9,
        sortBy: "s",
        configure: { hitsPerPage: 12 },
        refinementList: { brand: ["A"] },
      })
    ).toEqual({ sortBy: "s", configure: { hitsPerPage: 12 } })
  })

  it("resets a page beyond the last one when nothing else is set", async () => {
    indexUiState = { page: 40 }
    render(<StoreHits hitsPerPage={12} currencyCode="usd" />)
    await userEvent.click(clear())

    expect(reset()({ page: 40 })).toEqual({})
  })
})
