// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { HttpTypes } from "@medusajs/types"
import { cleanup, render } from "../../../../test/render"

import ProductSection from "./index"

afterEach(cleanup)

const product = (
  id: string,
  title: string,
  withPrice = true
): HttpTypes.StoreProduct =>
  ({
    id,
    title,
    handle: `h-${id}`,
    thumbnail: null,
    variants: withPrice
      ? [
          {
            id: `v-${id}`,
            calculated_price: {
              calculated_amount: 1000,
              original_amount: 1000,
              currency_code: "usd",
              calculated_price: { price_list_type: "default" },
            },
          },
        ]
      : [],
  }) as unknown as HttpTypes.StoreProduct

describe("ProductSection", () => {
  it("renders nothing for no products", () => {
    const { container } = render(<ProductSection title="New" products={[]} />)
    expect(container.innerHTML).toBe("")
  })

  it("renders heading, products and view all link", () => {
    const { container } = render(
      <ProductSection
        title="New arrivals"
        viewAllHref="/store"
        products={[product("1", "One"), product("2", "Two")]}
      />
    )
    expect(container.querySelector("h2")?.textContent).toBe("New arrivals")
    expect(
      container.querySelectorAll('[data-testid="product-wrapper"]')
    ).toHaveLength(2)
    const link = Array.from(container.querySelectorAll("a")).find(
      (a) => a.textContent?.includes("View all")
    )
    expect(link?.getAttribute("href")).toBe("/store")
  })

  it("clamps long titles", () => {
    const { container } = render(
      <ProductSection title="T" products={[product("1", "x".repeat(80))]} />
    )
    expect(
      container
        .querySelector('[data-testid="product-title"]')
        ?.className.includes("line-clamp-2")
    ).toBe(true)
  })

  it("renders a product without prices", () => {
    const { container } = render(
      <ProductSection title="T" products={[product("1", "One", false)]} />
    )
    expect(
      container.querySelectorAll('[data-testid="product-wrapper"]')
    ).toHaveLength(1)
    expect(container.querySelector('[data-testid="price"]')).toBeNull()
  })
})
