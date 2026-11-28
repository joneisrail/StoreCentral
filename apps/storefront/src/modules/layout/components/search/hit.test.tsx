// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render } from "../../../../test/render"

// The real search client pulls server-only modules; the thumbnail needs none.
vi.mock("@lib/search-client", () => ({
  priceAttribute: (field: string, currency: string) => `${field}_${currency}`,
  indexedCurrency: (currency: string) => currency,
}))

import { Thumbnail } from "./hit"

afterEach(cleanup)

describe("search hit Thumbnail", () => {
  it("renders a 44px optimised image", () => {
    const { container } = render(<Thumbnail src="/a.jpg" />)
    const img = container.querySelector("img") as HTMLImageElement
    expect(img.getAttribute("sizes")).toBe("44px")
    expect(img.getAttribute("srcset")).toContain("/_next/image")
  })

  it("shows the placeholder when the image fails", () => {
    const { container } = render(<Thumbnail src="/broken.jpg" />)
    act(() => {
      container.querySelector("img")?.dispatchEvent(new Event("error"))
    })
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector("svg")).not.toBeNull()
    expect(container.firstElementChild?.className).toContain("h-14")
  })
})
