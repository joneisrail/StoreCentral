// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { HttpTypes } from "@medusajs/types"
import { cleanup, render } from "../../../test/render"
import ProductTemplate from "./index"

vi.mock("./product-actions-wrapper", () => ({
  default: () => (
    <div data-testid="actions-wrapper">
      <button data-testid="add-product-button">Add to cart</button>
    </div>
  ),
}))
vi.mock("@modules/products/components/product-actions", () => ({
  default: () => <div data-testid="actions-fallback" />,
}))
vi.mock("@modules/products/components/related-products", () => ({
  default: () => <div data-testid="related" />,
}))
vi.mock("@modules/products/components/reviews", () => ({
  default: () => <div data-testid="reviews" />,
}))
vi.mock("@modules/products/components/recently-viewed", () => ({
  default: () => <div data-testid="recent" />,
}))
vi.mock("@modules/common/components/localized-client-link", () => ({
  default: ({
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    "data-testid"?: string
  }) => <a {...rest}>{children}</a>,
}))
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
}))

afterEach(cleanup)

const region = { id: "reg", currency_code: "usd" } as HttpTypes.StoreRegion

describe("ProductTemplate", () => {
  it("renders a bare product without metadata, images or variants", () => {
    const bare = { id: "p1", title: "Bare", handle: "bare" } as HttpTypes.StoreProduct
    const { container } = render(
      <ProductTemplate
        product={bare}
        region={region}
        countryCode="us"
        images={[]}
        brand={null}
        brandHref={null}
        reviews={null}
      />
    )
    expect(container.querySelectorAll("h1")).toHaveLength(1)
    expect(container.querySelector("h1")?.textContent).toBe("Bare")
    expect(
      container.querySelector('script[type="application/ld+json"]')
    ).not.toBeNull()
    expect(container.querySelector('[data-testid="reviews"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="related"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="recent"]')).not.toBeNull()
    expect(container.textContent).not.toContain("Fragrance profile")
  })

  it("shows brand link, review summary, profile and shipping note when present", () => {
    const product = {
      id: "p2",
      title: "Khamrah",
      handle: "khamrah",
      metadata: { fragrance_family: "Amber" },
    } as unknown as HttpTypes.StoreProduct
    const { container } = render(
      <ProductTemplate
        product={product}
        region={region}
        countryCode="us"
        images={[]}
        brand="Lattafa"
        brandHref="/categories/lattafa"
        shippingNote="Ships in 2 days"
        reviews={{ reviews: [], count: 3, average: 4.5 }}
      />
    )
    expect(
      container
        .querySelector('[data-testid="product-brand"]')
        ?.getAttribute("href")
    ).toBe("/categories/lattafa")
    expect(container.textContent).toContain("4.5 out of 5, 3 reviews")
    expect(container.textContent).toContain("Fragrance profile")
    expect(container.textContent).toContain("Shipping and returns")
    expect(container.querySelectorAll("h1")).toHaveLength(1)
  })

  it("places the description after the purchase panel, with one h1", () => {
    const product = {
      id: "p3",
      title: "Long",
      handle: "long",
      description: "A long description",
    } as HttpTypes.StoreProduct
    const { container } = render(
      <ProductTemplate
        product={product}
        region={region}
        countryCode="us"
        images={[]}
        brand={null}
        brandHref={null}
        reviews={null}
      />
    )
    const descriptions = container.querySelectorAll(
      '[data-testid="product-description"]'
    )
    expect(descriptions).toHaveLength(1)
    const button = container.querySelector('[data-testid="add-product-button"]')
    const title = container.querySelector("h1")
    expect(button).not.toBeNull()
    expect(
      title!.compareDocumentPosition(button!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      button!.compareDocumentPosition(descriptions[0]) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(container.querySelectorAll("h1")).toHaveLength(1)
  })
})