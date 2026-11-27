// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { HttpTypes } from "@medusajs/types"
import { cleanup, render } from "../../../../test/render"
import ProductInfo from "./index"

afterEach(cleanup)

const product = {
  id: "p",
  title: "Khamrah",
  description: "Warm and sweet",
} as HttpTypes.StoreProduct

describe("ProductInfo", () => {
  it("links the brand only when brandHref is set", () => {
    const { container } = render(
      <ProductInfo product={product} brand="Lattafa" brandHref="/brands/lattafa" />
    )
    const link = container.querySelector("a")
    expect(link?.textContent).toBe("Lattafa")
    expect(link?.getAttribute("href")).toContain("/brands/lattafa")
  })

  it("renders brand as plain text without href", () => {
    const { container } = render(
      <ProductInfo product={product} brand="Lattafa" brandHref={null} />
    )
    expect(container.querySelector("a")).toBeNull()
    expect(container.textContent).toContain("Lattafa")
  })

  it("renders title, summary and description; no brand when null", () => {
    const { container } = render(
      <ProductInfo
        product={product}
        brand={null}
        brandHref={null}
        summary={<span data-testid="sum">4.5</span>}
      />
    )
    expect(
      container.querySelector('[data-testid="product-title"]')?.textContent
    ).toBe("Khamrah")
    expect(container.querySelector('[data-testid="sum"]')).not.toBeNull()
    expect(container.textContent).toContain("Warm and sweet")
  })
})
