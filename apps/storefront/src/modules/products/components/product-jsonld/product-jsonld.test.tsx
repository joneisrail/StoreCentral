// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { HttpTypes } from "@medusajs/types"
import { cleanup, render } from "../../../../test/render"
import ProductJsonLd from "./index"

afterEach(cleanup)

const read = (container: HTMLElement): Record<string, unknown> => {
  const script = container.querySelector('script[type="application/ld+json"]')
  expect(script).not.toBeNull()
  return JSON.parse(script?.textContent ?? "{}")
}

const priced = {
  id: "p1",
  title: "Khamrah",
  handle: "khamrah",
  thumbnail: "https://cdn.test/thumb.jpg",
  images: [
    { id: "i1", url: "https://cdn.test/1.jpg" },
    { id: "i2", url: "https://cdn.test/2.jpg" },
  ],
  variants: [
    {
      id: "v1",
      sku: "KH-100",
      manage_inventory: true,
      allow_backorder: false,
      inventory_quantity: 0,
      calculated_price: {
        calculated_amount: 60,
        original_amount: 60,
        currency_code: "usd",
        calculated_price: { price_list_type: "default" },
      },
    },
    {
      id: "v2",
      sku: "KH-50",
      manage_inventory: true,
      allow_backorder: false,
      inventory_quantity: 3,
      calculated_price: {
        calculated_amount: 40,
        original_amount: 45,
        currency_code: "usd",
        calculated_price: { price_list_type: "sale" },
      },
    },
  ],
} as unknown as HttpTypes.StoreProduct

describe("ProductJsonLd", () => {
  it("renders offers from the cheapest variant and in-stock availability", () => {
    const { container } = render(
      <ProductJsonLd
        product={priced}
        url="https://shop.test/us/products/khamrah"
        brand="Lattafa"
        description="Warm"
        reviews={null}
        currencyCode="usd"
      />
    )
    const data = read(container)
    expect(data["@type"]).toBe("Product")
    expect(data.name).toBe("Khamrah")
    expect(data.sku).toBe("KH-50")
    expect(data.image).toEqual([
      "https://cdn.test/1.jpg",
      "https://cdn.test/2.jpg",
    ])
    expect(data.brand).toEqual({ "@type": "Brand", name: "Lattafa" })
    expect(data.offers).toMatchObject({
      price: 40,
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    })
    expect(data.aggregateRating).toBeUndefined()
    expect(data.review).toBeUndefined()
  })

  it("marks out of stock when no variant is available", () => {
    const product = {
      ...priced,
      variants: [priced.variants![0]],
    } as HttpTypes.StoreProduct
    const { container } = render(
      <ProductJsonLd
        product={product}
        url="u"
        brand={null}
        description="d"
        reviews={null}
        currencyCode="usd"
      />
    )
    expect(read(container).offers).toMatchObject({
      availability: "https://schema.org/OutOfStock",
    })
  })

  it("adds rating and at most 5 reviews when approved reviews exist", () => {
    const reviews = Array.from({ length: 7 }, (_, i) => ({
      id: `r${i}`,
      rating: 4,
      title: `t${i}`,
      comment: `c${i}`,
      created_at: "2026-11-01T00:00:00.000Z",
      author: `a${i}`,
    }))
    const { container } = render(
      <ProductJsonLd
        product={priced}
        url="u"
        brand={null}
        description="d"
        reviews={{ reviews, count: 7, average: 4.2 }}
        currencyCode="usd"
      />
    )
    const data = read(container)
    expect(data.aggregateRating).toMatchObject({
      ratingValue: 4.2,
      reviewCount: 7,
    })
    expect(data.review).toHaveLength(5)
  })

  it("omits rating when there are no reviews", () => {
    const { container } = render(
      <ProductJsonLd
        product={priced}
        url="u"
        brand={null}
        description="d"
        reviews={{ reviews: [], count: 0, average: null }}
        currencyCode="usd"
      />
    )
    expect(read(container).aggregateRating).toBeUndefined()
  })

  it("omits offers and sku for a bare product, falling back to the thumbnail", () => {
    const bare = {
      id: "p2",
      title: "Bare",
      thumbnail: "https://cdn.test/t.jpg",
    } as HttpTypes.StoreProduct
    const { container } = render(
      <ProductJsonLd
        product={bare}
        url="u"
        brand={null}
        description="d"
        reviews={null}
        currencyCode={null}
      />
    )
    const data = read(container)
    expect(data.offers).toBeUndefined()
    expect(data.sku).toBeUndefined()
    expect(data.image).toEqual(["https://cdn.test/t.jpg"])
  })

  it("never emits a raw < inside the script", () => {
    const evil = {
      ...priced,
      title: "</script><script>alert(1)</script>",
    } as HttpTypes.StoreProduct
    const { container } = render(
      <ProductJsonLd
        product={evil}
        url="u"
        brand={null}
        description="<b>"
        reviews={null}
        currencyCode="usd"
      />
    )
    const script = container.querySelector('script[type="application/ld+json"]')
    expect(script?.innerHTML).not.toContain("<")
    expect(read(container).name).toBe("</script><script>alert(1)</script>")
  })
})
