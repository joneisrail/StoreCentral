import { getProductPrice } from "@lib/util/get-product-price"
import { HttpTypes } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import type { ReactNode } from "react"
import Thumbnail from "../thumbnail"
import { PriceLabels } from "./price"

// The wishlist heart is a 44px target inset 0.5rem from the image corner.
// Badges stop short of it by one gap, and the list layout positions the heart
// from the same numbers.
const ACTION_SIZE_REM = 2.75
const ACTION_INSET_REM = 0.5
const ACTION_GAP_REM = 0.25
const BADGE_RIGHT_REM = ACTION_SIZE_REM + ACTION_INSET_REM + ACTION_GAP_REM

const GRID_SIZES = "(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, 50vw"
const LIST_SIZES = "(min-width: 640px) 40vw, 40vw"

export type ProductCardViewProps = {
  title: string
  href: string
  thumbnail?: string | null
  priceLabel?: string | null
  originalPriceLabel?: string | null
  /** Small pills shown over the image corner. */
  badges?: string[]
  /** Rendered over the image corner, outside the card link (e.g. a heart). */
  actions?: ReactNode
  /** Rendered below the text, outside the card link (e.g. quick add). */
  footer?: ReactNode
  layout?: "grid" | "list"
}

export function ProductCardView({
  title,
  href,
  thumbnail,
  priceLabel,
  originalPriceLabel,
  badges,
  actions,
  footer,
  layout = "grid",
}: ProductCardViewProps) {
  const isList = layout === "list"

  return (
    <div className="relative min-w-0">
      <LocalizedClientLink
        href={href}
        className="group block min-w-0 rounded-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-deep"
      >
        <div
          data-testid="product-wrapper"
          className={isList ? "flex min-w-0 items-start gap-4" : "min-w-0"}
        >
          <div className={isList ? "relative w-2/5 shrink-0" : "relative"}>
            <Thumbnail
              thumbnail={thumbnail}
              size="full"
              alt=""
              sizes={isList ? LIST_SIZES : GRID_SIZES}
              data-testid="product-thumbnail"
            />
            {badges && badges.length > 0 && (
              <div
                className="absolute left-2 top-2 flex flex-wrap gap-1"
                style={actions ? { right: `${BADGE_RIGHT_REM}rem` } : undefined}
              >
                {badges.map((badge) => (
                  <span
                    key={badge}
                    data-testid="product-badge"
                    className="rounded-soft border border-line bg-paper px-2 py-0.5 text-xs text-charcoal"
                  >
                    {badge}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div
            className={
              isList
                ? "flex min-w-0 flex-1 flex-col gap-y-1"
                : "mt-4 flex min-w-0 flex-col gap-y-1"
            }
          >
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
      {actions && (
        <div
          data-testid="product-actions"
          className="absolute top-2"
          style={
            isList
              ? { left: `calc(40% - ${ACTION_SIZE_REM + ACTION_INSET_REM}rem)` }
              : { right: `${ACTION_INSET_REM}rem` }
          }
        >
          {actions}
        </div>
      )}
      {footer && (
        <div
          data-testid="product-footer"
          className={isList ? "mt-2 sm:ml-[calc(40%+1rem)]" : "mt-2"}
        >
          {footer}
        </div>
      )}
    </div>
  )
}

export default async function ProductPreview({
  product,
  region: _region,
  layout,
}: {
  product: HttpTypes.StoreProduct
  region: HttpTypes.StoreRegion
  layout?: "grid" | "list"
}) {
  const { cheapestPrice } = getProductPrice({
    product,
  })

  return (
    <ProductCardView
      title={product.title ?? ""}
      layout={layout}
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
