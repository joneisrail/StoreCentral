"use client"

import { useState } from "react"
import {
  useClearRefinements,
  useCurrentRefinements,
  useInstantSearch,
} from "react-instantsearch"

import Drawer from "@modules/common/components/drawer"
import StoreRefinements from "./index"
import SortProducts from "./sort-products"

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2 focus-visible:ring-offset-paper"

/**
 * Below `small`: a sticky Filters button that opens the groups in a left
 * drawer. From `small` up the template shows the sidebar instead.
 */
const FilterDrawer = ({ currencyCode }: { currencyCode: string }) => {
  const [open, setOpen] = useState(false)
  const { items } = useCurrentRefinements()
  const { refine: clearAll } = useClearRefinements()
  const { results } = useInstantSearch()

  const count = items.reduce((sum, item) => sum + item.refinements.length, 0)
  const total = results?.nbHits ?? 0

  return (
    <div className="sticky top-0 z-20 -mx-6 mb-4 border-b border-line bg-ivory px-6 py-2 small:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex h-11 items-center rounded-soft border border-line-strong bg-paper px-4 text-sm font-medium text-charcoal hover:bg-ivory ${FOCUS}`}
        data-testid="filters-button"
      >
        {`Filters (${count})`}
      </button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Filters"
        side="left"
      >
        <div className="mt-6 flex-1 overflow-y-auto pr-2">
          <div className="flex flex-col gap-12">
            <SortProducts currencyCode={currencyCode} />
            <StoreRefinements currencyCode={currencyCode} />
          </div>
        </div>
        <div className="mt-4 flex gap-3 border-t border-line pt-4">
          <button
            type="button"
            onClick={() => clearAll()}
            className={`inline-flex h-11 flex-1 items-center justify-center rounded-soft border border-line-strong bg-paper px-4 text-sm font-medium text-charcoal hover:bg-ivory ${FOCUS}`}
            data-testid="drawer-clear-all"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className={`inline-flex h-11 flex-1 items-center justify-center rounded-soft bg-charcoal px-4 text-sm font-medium text-paper ${FOCUS}`}
            data-testid="drawer-show-results"
          >
            {`Show ${total} results`}
          </button>
        </div>
      </Drawer>
    </div>
  )
}

export default FilterDrawer
