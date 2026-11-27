import type { ReviewsPage } from "@lib/data/reviews"
import {
  buildProductJsonLd,
  getProductImageUrls,
  serializeJsonLd,
} from "@lib/util/product-seo"
import { getAvailability } from "@lib/util/variant-stock"
import { HttpTypes } from "@medusajs/types"

type ProductJsonLdProps = {
  product: HttpTypes.StoreProduct
  url: string
  brand: string | null
  description: string
  reviews: ReviewsPage | null
  /** Region currency, used when the priced variant carries none. */
  currencyCode: string | null
}

const priceOf = (variant: HttpTypes.StoreProductVariant): number | null => {
  const amount = variant.calculated_price?.calculated_amount
  return typeof amount === "number" ? amount : null
}

const cheapestOf = (
  variants: HttpTypes.StoreProductVariant[]
): HttpTypes.StoreProductVariant | null => {
  let best: HttpTypes.StoreProductVariant | null = null
  let bestAmount = Infinity
  for (const variant of variants) {
    const amount = priceOf(variant)
    if (amount !== null && amount < bestAmount) {
      best = variant
      bestAmount = amount
    }
  }
  return best
}

/**
 * The variant that supplies price, sku and availability: the cheapest one that
 * is not out of stock, else the overall cheapest.
 */
const offerVariant = (
  variants: HttpTypes.StoreProductVariant[]
): HttpTypes.StoreProductVariant | null =>
  cheapestOf(
    variants.filter((v) => getAvailability(v).state !== "out_of_stock")
  ) ?? cheapestOf(variants)

/** Server-rendered schema.org Product block for the product page. */
const ProductJsonLd = ({
  product,
  url,
  brand,
  description,
  reviews,
  currencyCode,
}: ProductJsonLdProps) => {
  const variants = product.variants ?? []
  const cheapest = offerVariant(variants)
  const price = cheapest?.calculated_price ?? null

  const images = getProductImageUrls(product)

  const availability = cheapest
    ? getAvailability(cheapest).state
    : "out_of_stock"

  const rating =
    reviews && reviews.count > 0 && reviews.average !== null
      ? { average: reviews.average, count: reviews.count }
      : null

  const data = buildProductJsonLd({
    name: product.title ?? "",
    url,
    images,
    description,
    sku: cheapest?.sku || null,
    brand,
    price: price?.calculated_amount ?? null,
    currency: price?.currency_code || currencyCode,
    availability,
    rating,
    reviews: rating ? reviews?.reviews ?? [] : [],
  })

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  )
}

export default ProductJsonLd
