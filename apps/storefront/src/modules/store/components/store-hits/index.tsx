"use client"

import { useEffect, useRef } from "react"
import {
  useClearRefinements,
  useHits,
  useInstantSearch,
} from "react-instantsearch"

import useSearchSettled from "@lib/hooks/use-search-settled"
import { Text } from "@modules/common/components/ui"
import SkeletonProductGrid from "@modules/skeletons/templates/skeleton-product-grid"
import type { CatalogHit } from "../../types"
import CatalogCard from "./catalog-card"
import SearchPagination from "./pagination"
import type { CatalogView } from "./view-state"

type StoreHitsProps = {
  hitsPerPage: number
  currencyCode: string
  view?: CatalogView
}

const StoreHits = ({
  hitsPerPage,
  currencyCode,
  view = "grid",
}: StoreHitsProps) => {
  const { items } = useHits<CatalogHit>()
  const { status, error, indexUiState, setIndexUiState } = useInstantSearch()
  const { refine: clearAll, canRefine: canClear } = useClearRefinements()
  const { isSearching, hasNoResultsYet } = useSearchSettled()

  const { page, ...refinements } = indexUiState
  const currentPage = page ?? 1
  const refinementKey = JSON.stringify(refinements)

  const settled = useRef({ page: currentPage, refinementKey })

  useEffect(() => {
    if (!isSearching) {
      settled.current = { page: currentPage, refinementKey }
    }
  }, [isSearching, currentPage, refinementKey])

  const isPagingOnly =
    refinementKey === settled.current.refinementKey &&
    currentPage !== settled.current.page

  const showSkeleton = hasNoResultsYet || (isSearching && isPagingOnly)

  // Clearing refinements resets the page itself; a requested page past the
  // last one has nothing to clear, so drop the page directly.
  const resetFilters = () => {
    if (canClear) {
      clearAll()
    } else {
      setIndexUiState((prev) => ({ ...prev, page: undefined }))
    }
  }

  if (status === "error") {
    return (
      <Text
        className="py-16 text-center text-charcoal"
        data-testid="products-error"
      >
        Couldn&apos;t load products
        {error?.message ? `: ${error.message}` : "."}
      </Text>
    )
  }

  return (
    <>
      {showSkeleton ? (
        <SkeletonProductGrid numberOfProducts={hitsPerPage} />
      ) : !items.length ? (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <Text className="text-warm-grey" data-testid="no-products">
            No products matched these filters.
          </Text>
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex min-h-[44px] items-center rounded-soft border border-line-strong bg-paper px-4 text-sm font-medium text-charcoal hover:bg-ivory focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2 focus-visible:ring-offset-ivory lg:min-h-0 lg:h-9"
            data-testid="no-products-clear"
          >
            Clear all
          </button>
        </div>
      ) : (
        <ul
          className={
            view === "list"
              ? "grid w-full grid-cols-1 gap-x-6 gap-y-8"
              : "grid w-full grid-cols-2 gap-x-6 gap-y-8 small:grid-cols-3 medium:grid-cols-4"
          }
          data-testid="products-list"
        >
          {items.map((hit) =>
            hit.handle ? (
              <li key={hit.objectID}>
                <CatalogCard
                  hit={hit}
                  currencyCode={currencyCode}
                  view={view}
                />
              </li>
            ) : null
          )}
        </ul>
      )}
      <SearchPagination />
    </>
  )
}

export default StoreHits
