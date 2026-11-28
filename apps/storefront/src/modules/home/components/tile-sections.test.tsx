// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "../../../test/render"

import type { TileCategory } from "@lib/data/homepage"
import BrandStrip from "./brand-strip"
import CategoryGrid from "./category-grid"

afterEach(cleanup)

const tiles = (n: number): TileCategory[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    name: `Name ${i}`,
    handle: `handle-${i}`,
    imageUrl: null,
  }))

describe.each([
  ["CategoryGrid", (list: TileCategory[]) => <CategoryGrid categories={list} />],
  ["BrandStrip", (list: TileCategory[]) => <BrandStrip brands={list} />],
])("%s", (_name, make) => {
  it("renders nothing when empty", () => {
    const { container } = render(make([]))
    expect(container.innerHTML).toBe("")
  })

  it("renders 50 tiles with unique category links", () => {
    const { container } = render(make(tiles(50)))
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) =>
      a.getAttribute("href")
    )
    expect(hrefs).toHaveLength(50)
    expect(new Set(hrefs).size).toBe(50)
    expect(hrefs[0]).toBe("/categories/handle-0")
  })

  it("wraps long names", () => {
    const list = tiles(1)
    list[0].name = "n".repeat(80)
    const { container } = render(make(list))
    const a = container.querySelector("a")
    expect(a?.className).toContain("min-w-0")
    expect(a?.innerHTML).toContain("break-words")
  })

  it("shows an image only when imageUrl exists", () => {
    const list = tiles(2)
    list[0].imageUrl = "https://img.test/a.jpg"
    const { container } = render(make(list))
    const imgs = container.querySelectorAll("img")
    expect(imgs).toHaveLength(1)
    expect(imgs[0].parentElement?.className).toContain("aspect-")
  })
})
