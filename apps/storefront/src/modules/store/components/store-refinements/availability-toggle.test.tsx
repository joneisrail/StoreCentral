// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, userEvent } from "../../../../test/render"
import AvailabilityToggle from "./availability-toggle"

const refine = vi.fn()
const hookOptions = vi.fn()
let canRefine = true

vi.mock("@lib/search-client", () => ({
  PRODUCT_INDEX_NAME: "product",
  priceAttribute: (field: string, currency: string) => `${field}_${currency}`,
}))
vi.mock("react-instantsearch", () => ({
  useToggleRefinement: (options: unknown) => {
    hookOptions(options)
    return {
      value: { isRefined: false, count: 12, name: "in_stock", onFacetValue: {}, offFacetValue: {} },
      refine,
      canRefine,
    }
  },
}))

beforeEach(() => {
  refine.mockReset()
  hookOptions.mockReset()
  canRefine = true
})

afterEach(cleanup)

describe("AvailabilityToggle", () => {
  it("renders nothing when it cannot refine", () => {
    canRefine = false
    const { container } = render(<AvailabilityToggle />)

    expect(container.innerHTML).toBe("")
  })

  it("filters on the in_stock attribute", () => {
    render(<AvailabilityToggle />)

    expect(hookOptions).toHaveBeenCalledWith({ attribute: "in_stock", on: true })
    expect(document.body.textContent).toContain("In stock only")
  })

  it("calls refine when toggled", async () => {
    const user = userEvent.setup()
    render(<AvailabilityToggle />)

    await user.click(document.querySelector('[data-testid="in-stock-toggle"]') as Element)
    expect(refine).toHaveBeenCalledTimes(1)
  })
})
