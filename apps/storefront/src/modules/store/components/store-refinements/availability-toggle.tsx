"use client"

import { useToggleRefinement } from "react-instantsearch"

import { IN_STOCK_ATTRIBUTE } from "./attributes"

/**
 * Narrows to products with at least one purchasable variant. Hides itself when
 * the current results cannot be split by availability.
 */
const AvailabilityToggle = () => {
  const { value, refine, canRefine } = useToggleRefinement({
    attribute: IN_STOCK_ATTRIBUTE,
    on: true,
  })

  if (!canRefine) {
    return null
  }

  return (
    <label className="flex min-h-[44px] cursor-pointer items-center gap-x-2 lg:min-h-0">
      <input
        type="checkbox"
        checked={value.isRefined}
        onChange={() => refine(value)}
        className="shrink-0 accent-ui-fg-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2"
        data-testid="in-stock-toggle"
      />
      <span className="txt-compact-small-plus text-ui-fg-subtle">
        In stock only
      </span>
      {typeof value.count === "number" && (
        <span className="text-small-regular text-ui-fg-muted">
          ({value.count})
        </span>
      )}
    </label>
  )
}

export default AvailabilityToggle
