import { HttpTypes } from "@medusajs/types"
import { Heading, Text } from "@modules/common/components/ui"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { ReactNode } from "react"

type ProductInfoProps = {
  product: HttpTypes.StoreProduct
  brand: string | null
  brandHref: string | null
  summary?: ReactNode
  /** When false the description is left for the caller to place. */
  showDescription?: boolean
}

export const ProductDescription = ({
  product,
}: {
  product: HttpTypes.StoreProduct
}) =>
  product.description ? (
    <Text
      className="text-base text-charcoal whitespace-pre-line"
      data-testid="product-description"
    >
      {product.description}
    </Text>
  ) : null

const ProductInfo = ({
  product,
  brand,
  brandHref,
  summary,
  showDescription = true,
}: ProductInfoProps) => {
  return (
    <div id="product-info">
      <div className="flex flex-col gap-y-4">
        {brand &&
          (brandHref ? (
            <LocalizedClientLink
              href={brandHref}
              className="text-sm uppercase tracking-widest text-warm-grey hover:text-charcoal"
              data-testid="product-brand"
            >
              {brand}
            </LocalizedClientLink>
          ) : (
            <span
              className="text-sm uppercase tracking-widest text-warm-grey"
              data-testid="product-brand"
            >
              {brand}
            </span>
          ))}
        <Heading
          level="h1"
          className="font-serif text-3xl leading-10 text-charcoal"
          data-testid="product-title"
        >
          {product.title}
        </Heading>

        {summary}

        {showDescription && <ProductDescription product={product} />}
      </div>
    </div>
  )
}

export default ProductInfo
