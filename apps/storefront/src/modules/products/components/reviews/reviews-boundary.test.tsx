// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "../../../../test/render"
import ReviewsBoundary from "./reviews-boundary"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const Boom = (): never => {
  throw new Error("reviews down")
}

describe("ReviewsBoundary", () => {
  it("renders children when they do not throw", () => {
    const { container } = render(
      <ReviewsBoundary>
        <p>ok</p>
      </ReviewsBoundary>
    )
    expect(container.textContent).toBe("ok")
  })

  it("shows the unavailable message when a child throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { container } = render(
      <ReviewsBoundary>
        <Boom />
      </ReviewsBoundary>
    )
    expect(container.textContent).toContain("Reviews are unavailable right now")
  })
})
