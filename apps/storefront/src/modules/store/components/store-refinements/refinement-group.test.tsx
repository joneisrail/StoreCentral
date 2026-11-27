// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, userEvent } from "../../../../test/render"
import RefinementGroup from "./refinement-group"

const refine = vi.fn()
const searchForItems = vi.fn()
const toggleShowMore = vi.fn()
const hookOptions = vi.fn()

let state: Record<string, unknown> = {}

vi.mock("react-instantsearch", () => ({
  useRefinementList: (options: unknown) => {
    hookOptions(options)
    return { refine, searchForItems, toggleShowMore, ...state }
  },
}))

const makeItems = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    value: `v${index}`,
    label: `Value ${index}`,
    count: index + 1,
    isRefined: false,
  }))

beforeEach(() => {
  refine.mockReset()
  searchForItems.mockReset()
  toggleShowMore.mockReset()
  hookOptions.mockReset()
  state = {
    items: [],
    canToggleShowMore: false,
    isShowingMore: false,
    isFromSearch: false,
  }
})

afterEach(cleanup)

describe("RefinementGroup", () => {
  it("renders nothing for an empty facet", () => {
    const { container } = render(
      <RefinementGroup attribute="brand" title="Brand" />
    )

    expect(container.innerHTML).toBe("")
  })

  it("asks the hook for 20 values and a larger show-more limit", () => {
    render(<RefinementGroup attribute="brand" title="Brand" />)

    expect(hookOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        attribute: "brand",
        limit: 20,
        showMore: true,
        showMoreLimit: 200,
      })
    )
  })

  it("shows neither search nor show more for a small facet", () => {
    state.items = makeItems(3)
    render(<RefinementGroup attribute="brand" title="Brand" />)

    expect(document.querySelector('input[type="search"]')).toBeNull()
    expect(document.body.textContent).not.toContain("Show more")
    expect(document.querySelectorAll('[data-testid="refinement-brand"]')).toHaveLength(3)
  })

  it("shows 20 values, show more and a search box for a large facet", async () => {
    state.items = makeItems(20)
    state.canToggleShowMore = true
    const user = userEvent.setup()
    render(<RefinementGroup attribute="brand" title="Brand" />)

    expect(document.querySelectorAll('[data-testid="refinement-brand"]')).toHaveLength(20)

    const input = document.querySelector(
      'input[type="search"]'
    ) as HTMLInputElement
    expect(input.getAttribute("aria-label")).toBe("Search Brand")

    await user.type(input, "ab")
    expect(searchForItems).toHaveBeenLastCalledWith("ab")

    const button = Array.from(document.querySelectorAll("button")).find(
      (node) => node.textContent === "Show more"
    ) as HTMLButtonElement
    await user.click(button)
    expect(toggleShowMore).toHaveBeenCalledTimes(1)
  })

  it("offers show less once expanded", () => {
    state.items = makeItems(45)
    state.canToggleShowMore = true
    state.isShowingMore = true
    render(<RefinementGroup attribute="brand" title="Brand" />)

    expect(document.body.textContent).toContain("Show less")
  })

  it("keeps the search box while a search has no matches", async () => {
    state.items = makeItems(20)
    state.canToggleShowMore = true
    const user = userEvent.setup()
    const { rerender } = render(
      <RefinementGroup attribute="brand" title="Brand" />
    )

    await user.type(document.querySelector('input[type="search"]') as Element, "zz")
    state = { ...state, items: [], canToggleShowMore: false, isFromSearch: true }
    rerender(<RefinementGroup attribute="brand" title="Brand" />)

    expect(document.querySelector('input[type="search"]')).not.toBeNull()
  })

  it("labels the group with its title", () => {
    state.items = makeItems(2)
    render(<RefinementGroup attribute="brand" title="Brand" />)

    const group = document.querySelector("fieldset") as HTMLElement
    expect(group.querySelector("legend")?.textContent).toBe("Brand")
  })

  it("clears the search box once a value is picked", async () => {
    state.items = makeItems(20)
    state.canToggleShowMore = true
    const user = userEvent.setup()
    render(<RefinementGroup attribute="brand" title="Brand" />)

    const input = document.querySelector('input[type="search"]') as HTMLInputElement
    await user.type(input, "val")
    await user.click(document.querySelector('[data-testid="refinement-brand"]') as Element)

    expect(refine).toHaveBeenCalledWith("v0")
    expect(input.value).toBe("")
    expect(searchForItems).toHaveBeenLastCalledWith("")
  })

  it("refines when a value is checked", async () => {
    state.items = makeItems(2)
    const user = userEvent.setup()
    render(<RefinementGroup attribute="brand" title="Brand" />)

    await user.click(document.querySelector("input") as Element)
    expect(refine).toHaveBeenCalledWith("v0")
  })
})
