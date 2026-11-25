import { indexedCurrency, priceAttribute } from "@lib/search-client"
import { convertToLocale } from "@lib/util/money"

/** The per-currency price fields a hit may carry, e.g. `min_price_eur`. */
export type HitPricing = Record<string, unknown>

const amount = (value: unknown) => (typeof value === "number" ? value : null)

/**
 * Formats a hit's indexed pricing into the labels ProductCardView renders.
 * A sale shows the original price only for a single (non-range) price.
 */
export const hitPriceLabels = (hit: HitPricing, currencyCode: string) => {
  const currency_code = indexedCurrency(currencyCode)
  const min_price = amount(hit[priceAttribute("min_price", currencyCode)])
  const max_price = amount(hit[priceAttribute("max_price", currencyCode)])
  const original_price = amount(
    hit[priceAttribute("original_price", currencyCode)]
  )
  const on_sale = hit[priceAttribute("on_sale", currencyCode)] === true

  if (min_price === null) {
    return { priceLabel: null, originalPriceLabel: null }
  }

  const format = (value: number) =>
    convertToLocale({ amount: value, currency_code })

  const max = max_price ?? min_price
  const isRange = max > min_price

  return {
    priceLabel: isRange
      ? `${format(min_price)} - ${format(max)}`
      : format(min_price),
    originalPriceLabel:
      !isRange && on_sale && original_price !== null
        ? format(original_price)
        : null,
  }
}
