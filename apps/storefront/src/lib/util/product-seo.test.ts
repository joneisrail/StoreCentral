import { describe, expect, it } from "vitest"
import {
  buildDescription,
  buildProductJsonLd,
  getProductImageUrls,
  serializeJsonLd,
} from "./product-seo"

describe("buildDescription", () => {
  it("truncates to 160 characters", () => {
    const out = buildDescription({
      brand: "Lattafa",
      family: "Oriental",
      description: "word ".repeat(100),
      title: "Khamrah",
    })
    expect(out.length).toBeLessThanOrEqual(160)
    expect(out.length).toBeGreaterThan(0)
  })

  it("falls back to the title", () => {
    expect(
      buildDescription({ brand: null, family: null, description: null, title: "Khamrah" }),
    ).toContain("Khamrah")
    expect(
      buildDescription({ brand: null, family: null, description: "  ", title: "Khamrah" }),
    ).not.toBe("")
  })
})

const base = {
  name: "Khamrah",
  url: "https://shop.test/products/khamrah",
  images: ["https://shop.test/a.jpg"],
  description: "Warm spicy",
  sku: "KH-100",
  brand: "Lattafa",
  price: 29.99,
  currency: "usd",
  inStock: true,
  rating: null,
  reviews: [],
}

const review = (i: number) => ({
  author: `A${i}`,
  rating: 5,
  title: "Great",
  comment: "Loved it",
  created_at: "2026-01-01T00:00:00Z",
})

describe("buildProductJsonLd", () => {
  it("omits offers without price and rating data", () => {
    const ld = buildProductJsonLd({ ...base, price: null })
    expect(ld).not.toHaveProperty("offers")
    expect(ld).not.toHaveProperty("aggregateRating")
    expect(ld).not.toHaveProperty("review")
    expect(ld["@type"]).toBe("Product")
  })

  it("includes offers when priced", () => {
    const ld = buildProductJsonLd(base) as { offers: Record<string, unknown> }
    expect(ld.offers.price).toBe(29.99)
    expect(ld.offers.priceCurrency).toBe("USD")
    expect(ld.offers.availability).toBe("https://schema.org/InStock")
  })

  it("includes rating and at most 5 reviews", () => {
    const ld = buildProductJsonLd({
      ...base,
      rating: { average: 4.5, count: 8 },
      reviews: Array.from({ length: 8 }, (_, i) => review(i)),
    }) as { aggregateRating: Record<string, unknown>; review: unknown[] }
    expect(ld.aggregateRating.ratingValue).toBe(4.5)
    expect(ld.aggregateRating.reviewCount).toBe(8)
    expect(ld.review).toHaveLength(5)
  })
})

describe("serializeJsonLd", () => {
  it("escapes angle brackets", () => {
    const out = serializeJsonLd({ name: "</script><b>" })
    expect(out).not.toContain("<")
    expect(JSON.parse(out)).toEqual({ name: "</script><b>" })
  })
})

describe("getProductImageUrls", () => {
  it("returns image urls, skipping blanks", () => {
    expect(
      getProductImageUrls({
        images: [{ url: "a.jpg" }, { url: "" }, null, { url: "b.jpg" }],
        thumbnail: "t.jpg",
      })
    ).toEqual(["a.jpg", "b.jpg"])
  })

  it("falls back to the thumbnail, then to empty", () => {
    expect(getProductImageUrls({ images: [], thumbnail: "t.jpg" })).toEqual([
      "t.jpg",
    ])
    expect(getProductImageUrls({})).toEqual([])
  })
})