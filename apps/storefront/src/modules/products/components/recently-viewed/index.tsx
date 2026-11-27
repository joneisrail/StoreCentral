"use client"

import { listProductsByIds } from "@lib/data/recent-products"
import { getProductPrice } from "@lib/util/get-product-price"
import {
  addRecent,
  readRecent,
  writeRecent,
} from "@lib/util/recently-viewed"
import { HttpTypes } from "@medusajs/types"
import { useEffect, useState } from "react"
import { ProductCardView } from "../product-preview"

type RecentlyViewedProps = {
  productId: string
  countryCode: string
}

export default function RecentlyViewed({
  productId,
  countryCode,
}: RecentlyViewedProps) {
  const [products, setProducts] = useState<HttpTypes.StoreProduct[]>([])

  useEffect(() => {
    let cancelled = false
    const previous = readRecent()
    writeRecent(addRecent(previous, productId))

    const others = previous.filter((id) => id !== productId)
    if (others.length === 0) {
      return
    }

    listProductsByIds(others, countryCode)
      .then((found) => {
        if (!cancelled) {
          setProducts(found.filter((p) => p.id !== productId))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProducts([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [productId, countryCode])

  if (products.length === 0) {
    return null
  }

  return (
    <section
      aria-labelledby="recently-viewed-heading"
      className="product-page-constraint"
    >
      <h2
        id="recently-viewed-heading"
        className="mb-12 text-center font-serif text-2xl text-charcoal"
      >
        Recently viewed
      </h2>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-8 small:grid-cols-3 medium:grid-cols-4">
        {products.map((product) => {
          const { cheapestPrice } = getProductPrice({ product })
          return (
            <li key={product.id}>
              <ProductCardView
                title={product.title ?? ""}
                href={`/products/${product.handle}`}
                thumbnail={product.thumbnail || product.images?.[0]?.url}
                priceLabel={cheapestPrice?.calculated_price}
                originalPriceLabel={
                  cheapestPrice?.price_type === "sale"
                    ? cheapestPrice.original_price
                    : null
                }
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}
