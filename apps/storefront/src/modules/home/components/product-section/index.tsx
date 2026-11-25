import { getProductPrice } from "@lib/util/get-product-price"
import { HttpTypes } from "@medusajs/types"
import { Heading } from "@modules/common/components/ui"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { ProductCardView } from "@modules/products/components/product-preview"

import Reveal from "../reveal"

const ProductSection = ({
  title,
  viewAllHref,
  products,
}: {
  title: string
  viewAllHref?: string
  products: HttpTypes.StoreProduct[]
}) => {
  if (!products.length) {
    return null
  }

  return (
    <Reveal>
      <section className="content-container py-12 small:py-24">
        <div className="mb-8 flex items-baseline justify-between gap-4">
          <Heading level="h2" className="min-w-0 break-words">
            {title}
          </Heading>
          {viewAllHref ? (
            <LocalizedClientLink
              href={viewAllHref}
              className="inline-flex min-h-[44px] shrink-0 items-center rounded-soft font-sans text-charcoal underline underline-offset-4 hover:text-gold-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2 focus-visible:ring-offset-ivory lg:min-h-0"
            >
              View all
            </LocalizedClientLink>
          ) : null}
        </div>
        <ul className="grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-4">
          {products.map((product) => {
            const { cheapestPrice } = getProductPrice({ product })
            return (
              <li key={product.id} className="min-w-0">
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
    </Reveal>
  )
}

export default ProductSection
