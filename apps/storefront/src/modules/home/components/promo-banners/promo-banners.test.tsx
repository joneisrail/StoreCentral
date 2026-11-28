// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "../../../../test/render"

import PromoBanners from "./index"

afterEach(cleanup)

describe("PromoBanners", () => {
  it("renders a lazy optimised image in a 16/9 box with the content alt", () => {
    const { container } = render(
      <PromoBanners
        promos={[
          {
            id: "p1",
            title: "Sale",
            href: "/sale",
            ctaLabel: "Shop",
            image: { src: "/p.jpg", alt: "A sale" },
          } as never,
        ]}
      />
    )
    const img = container.querySelector("img") as HTMLImageElement
    expect(img.getAttribute("alt")).toBe("A sale")
    expect(img.getAttribute("loading")).toBe("lazy")
    expect(img.getAttribute("fetchpriority")).toBeNull()
    expect(img.getAttribute("srcset")).toContain("/_next/image")
    expect(img.getAttribute("sizes")).toBe(
      "(min-width: 1440px) 684px, (min-width: 1024px) 50vw, 100vw"
    )
    expect(container.querySelector(".aspect-\\[16\\/9\\]")).not.toBeNull()
  })

  it("renders no image without one", () => {
    const { container } = render(
      <PromoBanners
        promos={[{ id: "p1", title: "S", href: "/s", ctaLabel: "Go" } as never]}
      />
    )
    expect(container.querySelector("img")).toBeNull()
  })
})
