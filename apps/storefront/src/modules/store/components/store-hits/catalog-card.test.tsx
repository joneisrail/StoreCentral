// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "../../../../test/render"
import type { CatalogHit } from "../../types"
import CatalogCard from "./catalog-card"

const quickAdd = vi.fn()

vi.mock("@lib/search-client", () => ({
  PRODUCT_INDEX_NAME: "product",
  priceAttribute: (field: string, currency: string) => `${field}_${currency}`,
  indexedCurrency: (currency: string) => currency,
}))
vi.mock("./quick-add", () => ({
  default: (props: Record<string, unknown>) => {
    quickAdd(props)
    return <div data-testid="quick-add-stub" />
  },
}))
vi.mock("@modules/wishlist/wishlist-button", () => ({
  default: ({ productId }: { productId: string }) => (
    <button data-testid="wishlist-stub">{productId}</button>
  ),
}))
vi.mock("@modules/common/components/localized-client-link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

afterEach(() => {
  cleanup()
  quickAdd.mockReset()
})

const hit = {
  objectID: "prod_1",
  title: "Oud",
  handle: "oud",
  thumbnail: null,
  in_stock: false,
  single_variant_id: "variant_1",
  min_price_usd: 1000,
  max_price_usd: 1000,
  on_sale_usd: true,
} as unknown as CatalogHit

describe("CatalogCard", () => {
  it("renders badges, heart and quick add outside the link", () => {
    render(<CatalogCard hit={hit} currencyCode="usd" view="grid" />)

    const badges = Array.from(
      document.querySelectorAll("[data-testid=product-badge]")
    )
    expect(badges.map((b) => b.textContent)).toEqual(["Sold out", "Sale"])
    const link = document.querySelector("a") as HTMLElement
    expect(link.getAttribute("href")).toBe("/products/oud")
    expect(
      link.contains(document.querySelector("[data-testid=wishlist-stub]"))
    ).toBe(false)
    expect(
      link.contains(document.querySelector("[data-testid=quick-add-stub]"))
    ).toBe(false)
    expect(document.querySelector("[data-testid=wishlist-stub]")).not.toBeNull()
  })

  it("passes stock and variant through to quick add", () => {
    render(<CatalogCard hit={hit} currencyCode="usd" view="grid" />)

    expect(quickAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: "prod_1",
        title: "Oud",
        inStock: false,
        singleVariantId: "variant_1",
        href: "/products/oud",
      })
    )
  })

  it("switches layout between grid and list", () => {
    render(<CatalogCard hit={hit} currencyCode="usd" view="list" />)
    expect(
      document.querySelector("[data-testid=product-wrapper]")?.className
    ).toContain("flex")
    cleanup()
    render(<CatalogCard hit={hit} currencyCode="usd" view="grid" />)
    expect(
      document.querySelector("[data-testid=product-wrapper]")?.className
    ).not.toContain("flex")
  })
})
