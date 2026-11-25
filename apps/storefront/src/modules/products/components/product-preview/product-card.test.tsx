// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "../../../../test/render"
import { ProductCardView } from "./index"

afterEach(cleanup)

describe("ProductCardView", () => {
  it("clamps a very long title to two lines and lets the root shrink", () => {
    const title = "A".repeat(300)
    const { container } = render(
      <ProductCardView title={title} href="/products/x" priceLabel="$10.00" />
    )
    const titleEl = container.querySelector('[data-testid="product-title"]')
    expect(titleEl?.textContent).toBe(title)
    expect(titleEl?.className).toContain("line-clamp-2")
    expect(container.querySelector('[data-testid="product-wrapper"]')?.className).toContain("min-w-0")
  })

  it("uses the same 4:5 ratio class for placeholder and image", () => {
    const empty = render(<ProductCardView title="T" href="/p" />)
    const placeholder = empty.container.querySelector('[data-testid="product-thumbnail"]')
    expect(placeholder?.className).toContain("aspect-[4/5]")
    expect(placeholder?.querySelector("svg")).not.toBeNull()
    cleanup()
    const withImage = render(
      <ProductCardView title="T" href="/p" thumbnail="https://example.com/a.jpg" />
    )
    const image = withImage.container.querySelector('[data-testid="product-thumbnail"]')
    expect(image?.className).toContain("aspect-[4/5]")
    expect(image?.querySelector("img")).not.toBeNull()
  })

  it("shows the original price struck through beside the sale price", () => {
    const { container } = render(
      <ProductCardView
        title="T"
        href="/p"
        priceLabel="$8.00"
        originalPriceLabel="$10.00"
      />
    )
    const original = container.querySelector('[data-testid="original-price"]')
    expect(original?.textContent).toBe("$10.00")
    expect(original?.className).toContain("line-through")
    expect(container.querySelector('[data-testid="price"]')?.textContent).toBe("$8.00")
  })

  it("links to href", () => {
    const { container } = render(<ProductCardView title="T" href="/products/abc" />)
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/products/abc")
  })
})
