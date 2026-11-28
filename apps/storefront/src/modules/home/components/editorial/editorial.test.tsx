// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "../../../../test/render"

import Editorial from "./index"

afterEach(cleanup)

describe("Editorial", () => {
  it("renders a lazy optimised image in a 4/3 box with the content alt", () => {
    const { container } = render(
      <Editorial
        blocks={[
          {
            id: "b1",
            title: "Story",
            text: "Text",
            image: { src: "/e.jpg", alt: "A story" },
          } as never,
        ]}
      />
    )
    const img = container.querySelector("img") as HTMLImageElement
    expect(img.getAttribute("alt")).toBe("A story")
    expect(img.getAttribute("loading")).toBe("lazy")
    expect(img.getAttribute("fetchpriority")).toBeNull()
    expect(img.getAttribute("srcset")).toContain("/_next/image")
    expect(img.getAttribute("sizes")).toBe(
      "(min-width: 1440px) 680px, (min-width: 1024px) 50vw, 100vw"
    )
    const box = container.querySelector(".aspect-\\[4\\/3\\]")
    expect(box?.className).toContain("rounded-soft")
  })

  it("renders no image box without an image", () => {
    const { container } = render(
      <Editorial blocks={[{ id: "b1", title: "S", text: "T" } as never]} />
    )
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector(".aspect-\\[4\\/3\\]")).toBeNull()
  })
})
