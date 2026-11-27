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
    expect(container.querySelector("a")?.className).toContain("min-w-0")
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

  it("passes a sizes hint per layout and keeps the thumbnail decorative", () => {
    const grid = render(
      <ProductCardView title="T" href="/p" thumbnail="https://example.com/a.jpg" />
    )
    const gridImg = grid.container.querySelector("img") as HTMLImageElement
    expect(gridImg.getAttribute("sizes")).toContain("25vw")
    expect(gridImg.getAttribute("alt")).toBe("")
    cleanup()
    const list = render(
      <ProductCardView
        title="T"
        href="/p"
        layout="list"
        thumbnail="https://example.com/a.jpg"
      />
    )
    expect(
      list.container.querySelector("img")?.getAttribute("sizes")
    ).toContain("40vw")
  })

  it("keeps badges clear of the actions slot", () => {
    const { container } = render(
      <ProductCardView
        title="T"
        href="/p"
        badges={["New"]}
        actions={<button type="button">Heart</button>}
      />
    )
    const badge = container.querySelector('[data-testid="product-badge"]')
    expect((badge?.parentElement as HTMLElement).style.right).toBe("3.5rem")
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

  it("shows badges as pills over the image", () => {
    const { container } = render(
      <ProductCardView title="T" href="/p" badges={["Sale", "New"]} />
    )
    const badges = container.querySelectorAll('[data-testid="product-badge"]')
    expect(Array.from(badges).map((b) => b.textContent)).toEqual(["Sale", "New"])
    expect(badges[0].className).toContain("bg-paper")
    expect(badges[0].className).toContain("text-charcoal")
  })

  it("renders actions outside the link and keeps the link free of buttons", () => {
    const { container } = render(
      <ProductCardView
        title="T"
        href="/p"
        actions={<button type="button">Heart</button>}
        footer={<button type="button">Quick add</button>}
      />
    )
    const link = container.querySelector("a")
    expect(link?.querySelector("button")).toBeNull()
    expect(link?.contains(container.querySelector('[data-testid="product-actions"]'))).toBe(false)
    expect(container.querySelector('[data-testid="product-actions"] button')?.textContent).toBe("Heart")
    expect(container.querySelector('[data-testid="product-footer"] button')?.textContent).toBe("Quick add")
  })

  it("switches the wrapper class for the list layout", () => {
    const grid = render(<ProductCardView title="T" href="/p" />)
    const gridClass = grid.container.querySelector('[data-testid="product-wrapper"]')?.className
    cleanup()
    const list = render(<ProductCardView title="T" href="/p" layout="list" />)
    const listClass = list.container.querySelector('[data-testid="product-wrapper"]')?.className
    expect(listClass).not.toBe(gridClass)
    expect(listClass).toContain("flex")
    expect(gridClass).not.toContain("flex ")
  })

  it("renders no badges, actions or footer by default", () => {
    const { container } = render(<ProductCardView title="T" href="/p" />)
    expect(container.querySelector('[data-testid="product-badge"]')).toBeNull()
    expect(container.querySelector('[data-testid="product-actions"]')).toBeNull()
    expect(container.querySelector('[data-testid="product-footer"]')).toBeNull()
    expect(container.querySelector('[data-testid="product-wrapper"]')?.className).toBe("min-w-0")
  })
})
