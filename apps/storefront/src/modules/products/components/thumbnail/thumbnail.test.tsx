// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { act, cleanup, render } from "../../../../test/render"

import Thumbnail from "./index"

afterEach(cleanup)

describe("Thumbnail", () => {
  it("renders an optimised image at quality 60 with the given sizes", () => {
    const { container } = render(
      <Thumbnail thumbnail="/a.jpg" sizes="96px" alt="Oud" />
    )
    const img = container.querySelector("img") as HTMLImageElement
    expect(img.getAttribute("alt")).toBe("Oud")
    expect(img.getAttribute("sizes")).toBe("96px")
    expect(img.getAttribute("srcset")).toContain("q=60")
    expect(img.getAttribute("draggable")).toBe("false")
  })

  it("shows the placeholder in the same box when the image fails", () => {
    const { container } = render(
      <Thumbnail thumbnail="/broken.jpg" size="square" data-testid="t" />
    )
    act(() => {
      container.querySelector("img")?.dispatchEvent(new Event("error"))
    })
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector("svg")).not.toBeNull()
    expect(
      container.querySelector('[data-testid="t"]')?.className
    ).toContain("aspect-[1/1]")
  })
})
