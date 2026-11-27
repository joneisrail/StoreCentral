"use client"

import { XMarkMini } from "@medusajs/icons"
import { useClearRefinements, useCurrentRefinements } from "react-instantsearch"

import { indexedCurrency, priceAttribute } from "@lib/search-client"
import { convertToLocale } from "@lib/util/money"
import {
  BRAND_ATTRIBUTE,
  CATEGORY_ATTRIBUTE,
  FAMILY_ATTRIBUTE,
  GENDER_ATTRIBUTE,
  IN_STOCK_ATTRIBUTE,
  LABELS_ATTRIBUTE,
  NOTES_ATTRIBUTE,
  OPTION_VALUES_ATTRIBUTE,
} from "./attributes"

type Refinement = ReturnType<
  typeof useCurrentRefinements
>["items"][number]["refinements"][number]

/**
 * What a single refinement reads as on its chip. The raw label is the facet
 * value, which is the option's `Size:M` form for options and a bare `true` for
 * the on-sale toggle — neither says what it filters on out of context.
 */
function refinementLabel(refinement: Refinement, currencyCode: string) {
  const { attribute, label, value, operator } = refinement

  if (attribute === OPTION_VALUES_ATTRIBUTE) {
    const separator = String(value).indexOf(":")

    return separator < 1
      ? label
      : `${String(value).slice(0, separator)}: ${String(value).slice(
          separator + 1
        )}`
  }

  if (attribute === priceAttribute("on_sale", currencyCode)) {
    return "On sale"
  }

  if (attribute === priceAttribute("min_price", currencyCode)) {
    const amount = convertToLocale({
      amount: Number(value),
      currency_code: indexedCurrency(currencyCode),
      maximumFractionDigits: 0,
    })

    return operator === "<=" || operator === "<"
      ? `Up to ${amount}`
      : `From ${amount}`
  }

  if (attribute === CATEGORY_ATTRIBUTE) {
    return `Category: ${label}`
  }

  if (attribute === LABELS_ATTRIBUTE) {
    return `Label: ${label}`
  }

  if (attribute === BRAND_ATTRIBUTE) {
    return `Brand: ${label}`
  }

  if (attribute === GENDER_ATTRIBUTE) {
    return `Gender: ${label}`
  }

  if (attribute === FAMILY_ATTRIBUTE) {
    return `Fragrance family: ${label}`
  }

  if (attribute === NOTES_ATTRIBUTE) {
    return `Note: ${label}`
  }

  if (attribute === IN_STOCK_ATTRIBUTE) {
    return "In stock"
  }

  return label
}

/**
 * Every active refinement as a chip that drops it, above the filters that set
 * them. The free-text query is excluded by the connector's own defaults, so
 * only what the sidebar controls shows up here.
 */
const CurrentRefinements = ({ currencyCode }: { currencyCode: string }) => {
  const { items, refine } = useCurrentRefinements()
  const { canRefine: canClearAll, refine: clearAll } = useClearRefinements()

  const refinements = items.flatMap((item) => item.refinements)

  if (!refinements.length) {
    return null
  }

  return (
    <div className="mb-4 flex flex-col gap-y-3" data-testid="current-refinements">
      <div className="flex items-center justify-between gap-x-2">
        <span className="text-sm text-warm-grey">
          Applied filters
        </span>
        {canClearAll && (
          <button
            onClick={clearAll}
            className="inline-flex min-h-[44px] items-center text-sm font-medium text-charcoal underline underline-offset-2 lg:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2 focus-visible:ring-offset-ivory"
            data-testid="clear-refinements"
          >
            Clear all
          </button>
        )}
      </div>

      <ul className="flex flex-wrap gap-2">
        {refinements.map((refinement) => {
          const label = refinementLabel(refinement, currencyCode)

          return (
            <li
              key={`${refinement.attribute}:${refinement.operator ?? ""}:${
                refinement.value
              }`}
            >
              <button
                onClick={() => refine(refinement)}
                aria-label={`Remove filter ${label}`}
                className="border border-line-strong bg-paper text-charcoal text-sm min-h-[44px] lg:min-h-0 lg:h-8 rounded-soft px-3 flex items-center gap-x-1.5 transition-colors motion-reduce:transition-none hover:bg-ivory focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2 focus-visible:ring-offset-ivory"
                data-testid="remove-refinement"
              >
                {label}
                <XMarkMini className="text-warm-grey" />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default CurrentRefinements
