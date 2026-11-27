"use client"

import { useSortBy } from "react-instantsearch"

import { getSortOptions } from "./attributes"

/** Compact sort control above the grid, shown at every width. */
const SortSelect = ({ currencyCode }: { currencyCode: string }) => {
  const items = getSortOptions(currencyCode)
  const { currentRefinement, refine } = useSortBy({ items })

  return (
    <label className="flex items-center gap-x-2 text-sm text-charcoal">
      <span className="text-warm-grey">Sort by</span>
      <select
        aria-label="Sort by"
        value={currentRefinement}
        onChange={(event) => refine(event.target.value)}
        className="h-11 rounded-soft border border-line-strong bg-paper px-3 text-sm text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2 focus-visible:ring-offset-ivory lg:h-9"
        data-testid="sort-select"
      >
        {items.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export default SortSelect
