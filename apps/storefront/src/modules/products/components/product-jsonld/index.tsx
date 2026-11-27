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

const cheapestVariant = (
  variants: HttpTypes.StoreProductVariant[]
): HttpTypes.StoreProductVariant | null => {
  let best: HttpTypes.StoreProductVariant | null = null
  for (const variant of variants) {
    const amount = variant.calculated_price?.calculated_amount
    if (typeof amount !== "number") {
      continue
    }
    const bestAmount = best?.calculated_price?.calculated_amount
    if (typeof bestAmount !== "number" || amount < bestAmount) {
      best = variant
    }
  }
  return best
}

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
  const cheapest = cheapestVariant(variants)
  const price = cheapest?.calculated_price ?? null

  const images = getProductImageUrls(product)

  const inStock = variants.some(
    (variant) => getAvailability(variant).state !== "out_of_stock"
  )

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
    inStock,
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
