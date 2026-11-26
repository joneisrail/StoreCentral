"use client"

import type { SearchClient } from "instantsearch.js"
import { history } from "instantsearch.js/es/lib/routers"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Configure, InstantSearch, useInstantSearch } from "react-instantsearch"

import { PRODUCT_INDEX_NAME, searchClient } from "@lib/search-client"
import StoreHits from "@modules/store/components/store-hits"
import {
  applyViewToUrl,
  createStateMapping,
  type CatalogRoute,
  readViewFromSearch,
  type CatalogView,
} from "@modules/store/components/store-hits/view-state"
import CurrentRefinements from "@modules/store/components/store-refinements/current-refinements"
import FilterDrawer from "@modules/store/components/store-refinements/filter-drawer"
import StoreRefinements from "@modules/store/components/store-refinements"
import SortSelect from "@modules/store/components/store-refinements/sort-select"
import StoreSearchBox from "@modules/store/components/store-search-box"
import ViewToggle from "@modules/store/components/view-toggle"

const PRODUCT_LIMIT = 12

const ResultCount = () => {
  const { results } = useInstantSearch()
  const total = results?.nbHits

  if (typeof total !== "number") {
    return null
  }

  return (
    <p
      className="text-sm text-warm-grey"
      aria-live="polite"
      data-testid="result-count"
    >
      {total === 1 ? "1 product" : `${total} products`}
    </p>
  )
}

const StoreTemplate = ({ currencyCode }: { currencyCode: string }) => {
  const [view, setView] = useState<CatalogView>("grid")
  // Read by the routing state mapping on every URL write.
  // Seeded from the URL up front so the router's first write keeps the param.
  const viewRef = useRef<CatalogView>(
    typeof window === "undefined"
      ? "grid"
      : readViewFromSearch(window.location.search)
  )

  const updateView = useCallback((next: CatalogView) => {
    viewRef.current = next
    setView(next)
  }, [])

  // The view param is not InstantSearch state: restore it after mount (no
  // window on the server) and again on back and forward.
  useEffect(() => {
    const sync = () => updateView(readViewFromSearch(window.location.search))

    sync()
    window.addEventListener("popstate", sync)

    return () => window.removeEventListener("popstate", sync)
  }, [updateView])

  const changeView = useCallback(
    (next: CatalogView) => {
      updateView(next)
      // A view-only change does not touch InstantSearch state, so the router
      // never writes it: update the URL here, keeping every other param.
      const url = applyViewToUrl(window.location.href, next)

      if (url !== window.location.href) {
        window.history.replaceState(window.history.state, "", url)
      }
    },
    [updateView]
  )

  const routing = useMemo(
    () => ({
      router: history<CatalogRoute>(),
      stateMapping: createStateMapping(PRODUCT_INDEX_NAME, () => viewRef.current),
    }),
    []
  )

  return (
    <div className="py-6 content-container" data-testid="category-container">
      <div className="mb-8 text-2xl-semi">
        <h1 data-testid="store-page-title">All products</h1>
      </div>

      <InstantSearch
        indexName={PRODUCT_INDEX_NAME}
        searchClient={searchClient as unknown as SearchClient}
        routing={routing}
        future={{ preserveSharedStateOnUnmount: true }}
      >
        <Configure hitsPerPage={PRODUCT_LIMIT} />
        <FilterDrawer currencyCode={currencyCode} />
        <div className="flex flex-col small:flex-row small:items-start small:gap-x-8">
          <aside
            aria-label="Filters"
            className="hidden small:block small:w-[250px] small:shrink-0 small:py-4"
          >
            <StoreRefinements currencyCode={currencyCode} />
          </aside>
          <div className="w-full min-w-0">
            <StoreSearchBox />
            <CurrentRefinements currencyCode={currencyCode} />
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <ResultCount />
              <div className="flex items-center gap-x-4">
                <SortSelect currencyCode={currencyCode} />
                <ViewToggle view={view} onChange={changeView} />
              </div>
            </div>
            <StoreHits
              hitsPerPage={PRODUCT_LIMIT}
              currencyCode={currencyCode}
              view={view}
            />
          </div>
        </div>
      </InstantSearch>
    </div>
  )
}

export default StoreTemplate
