// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "../../../../test/render"

import Tile from "./tile"

afterEach(cleanup)

const base = { id: "c1", name: "Woody", handle: "woody" }

describe("Tile", () => {
  it("renders a decorative lazy optimised image in a 4/3 box", () => {
    const { container } = render(
      <Tile tile={{ ...base, imageUrl: "/w.jpg" } as never} />
    )
    const img = container.querySelector("img") as HTMLImageElement
    expect(img.getAttribute("alt")).toBe("")
    expect(img.getAttribute("loading")).toBe("lazy")
    expect(img.getAttribute("fetchpriority")).toBeNull()
    expect(img.getAttribute("srcset")).toContain("/_next/image")
    expect(img.getAttribute("sizes")).toBe(
      "(min-width: 1440px) 336px, (min-width: 1024px) 25vw, 50vw"
    )
    expect(container.querySelector(".aspect-\\[4\\/3\\]")).not.toBeNull()
  })

  it("renders no image without imageUrl", () => {
    const { container } = render(<Tile tile={base as never} />)
    expect(container.querySelector("img")).toBeNull()
    expect(container.textContent).toContain("Woody")
  })
})
