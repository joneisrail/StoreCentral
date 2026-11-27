import { listProducts } from "@lib/data/products"
import { getRegion } from "@lib/data/regions"
import { toBrandName } from "@lib/util/fragrance-profile"
import { HttpTypes } from "@medusajs/types"
import Product from "../product-preview"
import { buildRelatedQuery } from "./related-query"

type RelatedProductsProps = {
  product: HttpTypes.StoreProduct
  countryCode: string
}

const RELATED_CAP = 8

export default async function RelatedProducts({
  product,
  countryCode,
}: RelatedProductsProps) {
  const region = await getRegion(countryCode)

  if (!region) {
    return null
  }

  const relatedQuery = buildRelatedQuery(product)
  if (!relatedQuery.category_id && !relatedQuery.collection_id) {
    return null
  }

  const products = await listProducts({
    queryParams: {
      ...relatedQuery,
      region_id: region.id,
      is_giftcard: false,
      limit: RELATED_CAP + 1,
    },
    countryCode,
  })
    .then(({ response }) =>
      response.products
        .filter((responseProduct) => responseProduct.id !== product.id)
        .slice(0, RELATED_CAP)
    )
    .catch(() => [] as HttpTypes.StoreProduct[])

  if (!products.length) {
    return null
  }

  const brand = toBrandName(product)

  return (
    <section
      aria-labelledby="related-products-heading"
      className="product-page-constraint"
    >
      <div className="mb-12 flex flex-col items-center text-center">
        <h2
          id="related-products-heading"
          className="font-serif text-2xl text-charcoal"
        >
          {brand ? `More from ${brand}` : "You may also like"}
        </h2>
      </div>

      <ul className="grid grid-cols-2 gap-x-6 gap-y-8 small:grid-cols-3 medium:grid-cols-4">
        {products.map((related) => (
          <li key={related.id}>
            <Product region={region} product={related} />
          </li>
        ))}
      </ul>
    </section>
  )
}
