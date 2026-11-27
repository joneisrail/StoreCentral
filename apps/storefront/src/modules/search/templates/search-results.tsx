"use client"

import type { SearchClient } from "instantsearch.js"
import { history } from "instantsearch.js/es/lib/routers"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Configure,
  InstantSearch,
  useCurrentRefinements,
  useInstantSearch,
} from "react-instantsearch"

import { trackSearch } from "@lib/data/track-search"
import { PRODUCT_INDEX_NAME, searchClient } from "@lib/search-client"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import StoreHits from "@modules/store/components/store-hits"
import {
  applyViewToUrl,
  createPush,
  type CatalogRoute,
  type CatalogView,
  readViewFromSearch,
} from "@modules/store/components/store-hits/view-state"
import CurrentRefinements from "@modules/store/components/store-refinements/current-refinements"
import FilterDrawer from "@modules/store/components/store-refinements/filter-drawer"
import StoreRefinements from "@modules/store/components/store-refinements"
import SortSelect from "@modules/store/components/store-refinements/sort-select"
import ViewToggle from "@modules/store/components/view-toggle"
import {
  createSearchStateMapping,
  isUnrefinedState,
  MIN_TRACKED_LENGTH,
} from "./search-query"

const PRODUCT_LIMIT = 12

const isArtificial = (results: unknown): boolean =>
  Boolean((results as { __isArtificial?: boolean } | undefined)?.__isArtificial)

/**
 * Records the query once its first result set has settled. Keyed by the query
 * the results belong to, so filters, paging and re-renders never re-track and
 * a different query does.
 */
const SearchTracker = ({ query }: { query: string }) => {
  const { status, results } = useInstantSearch()
  const { items } = useCurrentRefinements()
  const refined = items.length > 0
  const tracked = useRef<string | null>(null)
  // A refined count is not the query's count: record only result sets whose
  // own helper state is unrefined (the UI state can run ahead of `results`),
  // and only for this page's query (not a stale set from another one).
  const resultQuery = (results?.query ?? "").trim()
  const settledQuery =
    status === "idle" &&
    !refined &&
    results &&
    !isArtificial(results) &&
    isUnrefinedState((results as unknown as { _state?: unknown })._state) &&
    resultQuery === query.trim()
      ? resultQuery
      : null
  const nbHits = results?.nbHits

  useEffect(() => {
    if (
      settledQuery === null ||
      typeof nbHits !== "number" ||
      settledQuery.length < MIN_TRACKED_LENGTH ||
      tracked.current === settledQuery
    ) {
      return
    }
    tracked.current = settledQuery
    trackSearch(settledQuery, nbHits)
  }, [settledQuery, nbHits])

  return null
}

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

const SearchBody = ({
  query,
  popular,
  currencyCode,
  view,
}: {
  query: string
  popular: string[] | null
  currencyCode: string
  view: CatalogView
}) => {
  const { status, results } = useInstantSearch()
  const { items } = useCurrentRefinements()

  if (status === "error") {
    return (
      <p
        className="py-16 text-center text-charcoal"
        data-testid="search-error"
        role="alert"
      >
        Search is unavailable right now. Please try again.
      </p>
    )
  }

  if (status === "idle" && !isArtificial(results) && results?.nbHits === 0) {
    if (items.length > 0) {
      return (
        <div
          className="flex flex-col items-center gap-3 py-16 text-center"
          data-testid="search-no-filter-results"
        >
          <p className="font-serif text-xl text-charcoal">
            No fragrances match these filters.
          </p>
          <p className="text-sm text-warm-grey">Try removing a filter.</p>
        </div>
      )
    }

    const links = (popular ?? []).filter(Boolean)
    return (
      <div
        className="flex flex-col items-center gap-3 py-16 text-center"
        data-testid="search-no-results"
      >
        <p className="font-serif text-xl text-charcoal">
          No fragrances found for “{query}”.
        </p>
        <p className="text-sm text-warm-grey">
          Check the spelling or try a broader term such as a brand or a note.
        </p>
        {links.length > 0 && (
          <ul
            className="mt-2 flex flex-wrap justify-center gap-2"
            aria-label="Popular searches"
            data-testid="search-popular"
          >
            {links.map((term) => (
              <li key={term}>
                <LocalizedClientLink
                  href={`/search?q=${encodeURIComponent(term)}`}
                  className="inline-flex min-h-[44px] items-center rounded-soft border border-line-strong bg-paper px-4 text-sm text-charcoal hover:bg-ivory"
                >
                  {term}
                </LocalizedClientLink>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <StoreHits
      hitsPerPage={PRODUCT_LIMIT}
      currencyCode={currencyCode}
      view={view}
    />
  )
}

const SearchResults = ({
  query,
  currencyCode,
  popularSearches = null,
  initialView = "grid",
}: {
  query: string
  currencyCode: string
  popularSearches?: string[] | null
  initialView?: CatalogView
}) => {
  const [view, setView] = useState<CatalogView>(initialView)
  const viewRef = useRef<CatalogView>(
    typeof window === "undefined"
      ? initialView
      : readViewFromSearch(window.location.search)
  )

  const updateView = useCallback((next: CatalogView) => {
    viewRef.current = next
    setView(next)
  }, [])

  useEffect(() => {
    const sync = () => updateView(readViewFromSearch(window.location.search))

    sync()
    window.addEventListener("popstate", sync)

    return () => window.removeEventListener("popstate", sync)
  }, [updateView])

  const changeView = useCallback(
    (next: CatalogView) => {
      updateView(next)
      const url = applyViewToUrl(window.location.href, next)

      if (url !== window.location.href) {
        window.history.replaceState(window.history.state, "", url)
      }
    },
    [updateView]
  )

  const routing = useMemo(
    () => ({
      router: history<CatalogRoute>({ push: createPush(() => viewRef.current) }),
      stateMapping: createSearchStateMapping(
        PRODUCT_INDEX_NAME,
        () => viewRef.current
      ),
    }),
    []
  )

  return (
    <div className="py-6 content-container" data-testid="search-container">
      <div className="mb-8">
        <h1
          className="font-serif text-3xl text-charcoal"
          data-testid="search-page-title"
        >
          Results for “{query}”
        </h1>
      </div>

      <InstantSearch
        indexName={PRODUCT_INDEX_NAME}
        searchClient={searchClient as unknown as SearchClient}
        routing={routing}
        future={{ preserveSharedStateOnUnmount: true }}
      >
        <Configure hitsPerPage={PRODUCT_LIMIT} />
        <SearchTracker query={query} />
        <FilterDrawer currencyCode={currencyCode} />
        <div className="flex flex-col small:flex-row small:items-start small:gap-x-8">
          <aside
            aria-label="Filters"
            className="hidden small:block small:w-[250px] small:shrink-0 small:py-4"
          >
            <StoreRefinements currencyCode={currencyCode} />
          </aside>
          <div className="w-full min-w-0">
            <CurrentRefinements currencyCode={currencyCode} />
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <ResultCount />
              <div className="flex items-center gap-x-4">
                <SortSelect currencyCode={currencyCode} />
                <ViewToggle view={view} onChange={changeView} />
              </div>
            </div>
            <SearchBody
              query={query}
              popular={popularSearches}
              currencyCode={currencyCode}
              view={view}
            />
          </div>
        </div>
      </InstantSearch>
    </div>
  )
}

export default SearchResults
