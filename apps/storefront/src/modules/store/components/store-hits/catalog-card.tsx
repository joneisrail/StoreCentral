"use client"

import { ProductCardView } from "@modules/products/components/product-preview"
import WishlistButton from "@modules/wishlist/wishlist-button"
import type { CatalogHit } from "../../types"
import { getBadges } from "./get-badges"
import { hitPriceLabels } from "./price"
import QuickAdd from "./quick-add"
import type { CatalogView } from "./view-state"

type CatalogCardProps = {
  hit: CatalogHit
  currencyCode: string
  view: CatalogView
}

const CatalogCard = ({ hit, currencyCode, view }: CatalogCardProps) => {
  const title = hit.title ?? ""
  const href = `/products/${hit.handle}`

  return (
    <ProductCardView
      title={title}
      href={href}
      thumbnail={hit.thumbnail}
      layout={view}
      badges={getBadges(hit, currencyCode)}
      actions={<WishlistButton productId={hit.objectID} title={title} />}
      footer={
        <QuickAdd
          productId={hit.objectID}
          title={title}
          inStock={hit.in_stock}
          singleVariantId={hit.single_variant_id}
          href={href}
        />
      }
      {...hitPriceLabels(hit, currencyCode)}
    />
  )
}

export default CatalogCard
