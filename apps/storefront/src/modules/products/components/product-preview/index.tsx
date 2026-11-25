import { getProductPrice } from "@lib/util/get-product-price"
import { HttpTypes } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import Thumbnail from "../thumbnail"
import { PriceLabels } from "./price"

export type ProductCardViewProps = {
  title: string
  href: string
  thumbnail?: string | null
  priceLabel?: string | null
  originalPriceLabel?: string | null
}

export function ProductCardView({
  title,
  href,
  thumbnail,
  priceLabel,
  originalPriceLabel,
}: ProductCardViewProps) {
  return (
    <LocalizedClientLink
      href={href}
      className="group block min-w-0 rounded-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-deep"
    >
      <div data-testid="product-wrapper" className="min-w-0">
        <Thumbnail
          thumbnail={thumbnail}
          size="full"
          data-testid="product-thumbnail"
        />
        <div className="mt-4 flex min-w-0 flex-col gap-y-1">
          <p
            className="line-clamp-2 break-words font-serif text-base text-charcoal"
            data-testid="product-title"
          >
            {title}
          </p>
          <PriceLabels
            priceLabel={priceLabel}
            originalPriceLabel={originalPriceLabel}
          />
        </div>
      </div>
    </LocalizedClientLink>
  )
}

export default async function ProductPreview({
  product,
  region: _region,
}: {
  product: HttpTypes.StoreProduct
  region: HttpTypes.StoreRegion
}) {
  const { cheapestPrice } = getProductPrice({
    product,
  })

  return (
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
  )
}
