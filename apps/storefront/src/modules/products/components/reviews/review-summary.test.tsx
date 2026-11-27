// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "../../../../test/render"
import ReviewSummary from "./review-summary"

afterEach(cleanup)

describe("ReviewSummary", () => {
  it("renders nothing when there are no reviews", () => {
    const { container } = render(<ReviewSummary average={null} count={0} />)
    expect(container.innerHTML).toBe("")
  })

  it("exposes accessible text", () => {
    const { container } = render(<ReviewSummary average={4.5} count={12} />)
    expect(container.textContent).toContain("4.5 out of 5, 12 reviews")
  })

  it("uses singular for one review", () => {
    const { container } = render(<ReviewSummary average={5} count={1} />)
    expect(container.textContent).toContain("5 out of 5, 1 review")
    expect(container.textContent).not.toContain("1 reviews")
  })
})
