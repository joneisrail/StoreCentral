"use client"

import Image from "next/image"

import { renderHighlight } from "@lib/util/highlight"
import PlaceholderImage from "@modules/common/icons/placeholder-image"
import { hitPriceLabels } from "@modules/store/components/store-hits/price"
import type { ProductHit } from "./rows"

export type { ProductHit } from "./rows"

export const Thumbnail = ({ src }: { src: string | null }) => (
  <div className="relative h-14 w-11 shrink-0 overflow-hidden rounded-soft bg-paper">
    {src ? (
      <Image
        src={src}
        alt=""
        fill
        sizes="44px"
        className="object-cover object-center"
        draggable={false}
      />
    ) : (
      <div className="flex h-full w-full items-center justify-center text-warm-grey">
        <PlaceholderImage size={18} />
      </div>
    )}
  </div>
)

/**
 * The title with the matched words marked. Highlights only ever go through
 * `renderHighlight`, which never parses HTML, so markup in a title is text.
 */
const highlightedTitle = (hit: ProductHit) => {
  const value = (
    hit._highlightResult as { title?: { value?: unknown } } | undefined
  )?.title?.value
  return typeof value === "string" ? renderHighlight(value) : hit.title ?? ""
}

type SearchHitProps = { hit: ProductHit; currencyCode: string }

/** The content of a product row; the row itself is an `Option`. */
const SearchHit = ({ hit, currencyCode }: SearchHitProps) => {
  const { priceLabel, originalPriceLabel } = hitPriceLabels(hit, currencyCode)
  const brand = hit.brand?.[0]

  return (
    <>
      <Thumbnail src={hit.thumbnail} />
      <span className="flex min-w-0 flex-1 flex-col">
        {brand && (
          <span className="text-xs uppercase tracking-wider text-warm-grey">
            {brand}
          </span>
        )}
        <span className="line-clamp-2 text-charcoal [&_mark]:bg-transparent [&_mark]:font-semibold [&_mark]:text-gold-deep">
          {highlightedTitle(hit)}
        </span>
      </span>
      {priceLabel && (
        <span className="flex shrink-0 flex-col items-end text-sm">
          <span className="text-charcoal">{priceLabel}</span>
          {originalPriceLabel && (
            <span className="text-xs text-warm-grey line-through">
              {originalPriceLabel}
            </span>
          )}
        </span>
      )}
    </>
  )
}

export default SearchHit
