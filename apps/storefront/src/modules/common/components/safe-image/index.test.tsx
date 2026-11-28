// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { act, cleanup, render } from "../../../../test/render"

import SafeImage from "./index"

afterEach(cleanup)

const mount = () =>
  render(
    <div
      data-testid="box"
      className="relative aspect-[4/3] w-full overflow-hidden"
    >
      <SafeImage src="/a.jpg" alt="Alt text" sizes="50vw" />
    </div>
  )

describe("SafeImage", () => {
  it("renders a lazy optimised image", () => {
    const { container } = mount()
    const img = container.querySelector("img") as HTMLImageElement
    expect(img.getAttribute("alt")).toBe("Alt text")
    expect(img.getAttribute("loading")).toBe("lazy")
    expect(img.getAttribute("sizes")).toBe("50vw")
    expect(img.getAttribute("srcset")).toContain("/_next/image")
    expect(img.getAttribute("fetchpriority")).toBeNull()
  })

  it("is eager and preloaded when priority is set", () => {
    const { container } = render(
      <div className="relative">
        <SafeImage src="/a.jpg" alt="x" sizes="50vw" priority />
      </div>
    )
    expect(container.querySelector("img")?.getAttribute("loading")).toBeNull()
    expect(
      document.querySelectorAll('link[rel="preload"][as="image"]').length
    ).toBeGreaterThan(0)
  })

  it("swaps the broken image for the placeholder and keeps the box", () => {
    const { container } = mount()
    const img = container.querySelector("img") as HTMLImageElement
    act(() => {
      img.dispatchEvent(new Event("error"))
    })
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector("svg")).not.toBeNull()
    const box = container.querySelector('[data-testid="box"]')
    expect(box?.className).toContain("aspect-[4/3]")
  })
})
