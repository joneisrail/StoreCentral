// @vitest-environment jsdom
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { act, cleanup, render, userEvent } from "../../../../test/render"
import FilterDrawer from "./filter-drawer"

const clearRefinements = vi.fn()
let hitCount: number | undefined = 42

vi.mock("react-instantsearch", () => ({
  useCurrentRefinements: () => ({
    items: [
      { refinements: [{ value: "a" }, { value: "b" }] },
      { refinements: [{ value: "c" }] },
    ],
  }),
  useClearRefinements: () => ({ refine: clearRefinements, canRefine: true }),
  useInstantSearch: () => ({
    results: hitCount === undefined ? undefined : { nbHits: hitCount },
  }),
}))
vi.mock("./index", () => ({
  default: () => <div data-testid="groups-stub" />,
}))
vi.mock("./sort-products", () => ({
  default: () => <div data-testid="sort-by-container" />,
}))

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= RO
  ;(Element.prototype as unknown as { getAnimations?: unknown }).getAnimations ??=
    () => []
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  window.scrollTo = (() => {}) as typeof window.scrollTo
})

beforeEach(() => clearRefinements.mockReset())
afterEach(cleanup)

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 150))
  })

const open = async () => {
  render(<FilterDrawer currencyCode="usd" />)
  await userEvent.click(
    document.querySelector("[data-testid=filters-button]") as HTMLElement
  )
  await settle()
}

describe("FilterDrawer", () => {
  it("shows the active count on the button", () => {
    render(<FilterDrawer currencyCode="usd" />)
    expect(
      document.querySelector("[data-testid=filters-button]")?.textContent
    ).toBe("Filters (3)")
  })

  it("opens a drawer titled Filters with sort and groups", async () => {
    await open()
    const dialog = document.querySelector("[role=dialog]") as HTMLElement
    expect(dialog).not.toBeNull()
    expect(dialog.textContent).toContain("Filters")
    expect(document.querySelector("[data-testid=groups-stub]")).not.toBeNull()
    expect(
      document.querySelector("[data-testid=sort-by-container]")
    ).not.toBeNull()
  })

  it("clears everything", async () => {
    await open()
    await userEvent.click(
      document.querySelector("[data-testid=drawer-clear-all]") as HTMLElement
    )
    expect(clearRefinements).toHaveBeenCalled()
  })

  it("says Show results before a count exists", async () => {
    hitCount = undefined
    await open()
    expect(
      document.querySelector("[data-testid=drawer-show-results]")?.textContent
    ).toBe("Show results")
    hitCount = 42
  })

  it("closes on Show N results", async () => {
    await open()
    const show = document.querySelector(
      "[data-testid=drawer-show-results]"
    ) as HTMLElement
    expect(show.textContent).toBe("Show 42 results")
    await userEvent.click(show)
    await settle()
    expect(document.querySelector("[role=dialog]")).toBeNull()
  })
})
