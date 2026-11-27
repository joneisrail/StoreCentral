"use client"

import { MagnifyingGlass } from "@medusajs/icons"
import type { SearchClient } from "instantsearch.js"
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react"
import { Configure, InstantSearch } from "react-instantsearch"

import { HIGHLIGHT_POST, HIGHLIGHT_PRE } from "@lib/util/highlight"
import { PRODUCT_INDEX_NAME } from "@lib/search-client"
import SearchDrawer from "./drawer"
import SearchOverlay from "./overlay"
import { overlaySearchClient } from "./overlay-client"
import type { SearchInsights } from "./rows"

export type { SearchInsights } from "./rows"

const HITS_PER_PAGE = 8
// Facet values fetched per attribute; the overlay shows the best three.
const FACET_VALUES = 10
const FACETS = ["brand", "category"]
const HIGHLIGHT = ["title"]

/**
 * Popular and trending data arrive as a promise from the server so the navbar
 * never waits on them; their sections appear when it settles.
 */
function useInsights(source: Promise<SearchInsights> | undefined) {
  const [insights, setInsights] = useState<SearchInsights | null>(null)
  useEffect(() => {
    let live = true
    source?.then(
      (value) => live && setInsights(value),
      () => {}
    )
    return () => {
      live = false
    }
  }, [source])
  return insights
}

type SearchProps = {
  /** The region's currency, for product prices in the results. */
  currencyCode: string
  insights?: Promise<SearchInsights>
}

const Search = ({ currencyCode, insights }: SearchProps) => {
  const [isOpen, setOpen] = useState(false)
  const opener = useRef<HTMLElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const resolved = useInsights(insights)

  const open = (event: MouseEvent<HTMLElement>) => {
    opener.current = event.currentTarget
    setOpen(true)
  }
  const close = useCallback(() => setOpen(false), [])
  const restoreFocus = useCallback(() => opener.current?.focus(), [])

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label="Search products"
        aria-haspopup="dialog"
        className="flex min-h-[44px] min-w-[44px] items-center justify-center hover:text-gold-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2 small:hidden"
        data-testid="nav-search-button"
      >
        <MagnifyingGlass />
      </button>
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        className="hidden h-11 min-w-[10rem] items-center gap-x-2 rounded-soft border border-line bg-paper px-3 font-sans text-charcoal hover:text-gold-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2 small:flex medium:min-w-[14rem]"
        data-testid="nav-search-field"
      >
        <MagnifyingGlass className="shrink-0" />
        <span>Search products</span>
      </button>

      <SearchDrawer
        isOpen={isOpen}
        close={close}
        afterLeave={restoreFocus}
        initialFocus={inputRef}
      >
        <InstantSearch
          indexName={PRODUCT_INDEX_NAME}
          searchClient={overlaySearchClient as unknown as SearchClient}
          future={{ preserveSharedStateOnUnmount: true }}
        >
          <Configure
            hitsPerPage={HITS_PER_PAGE}
            facets={FACETS}
            maxValuesPerFacet={FACET_VALUES}
            attributesToHighlight={HIGHLIGHT}
            highlightPreTag={HIGHLIGHT_PRE}
            highlightPostTag={HIGHLIGHT_POST}
          />
          <SearchOverlay
            currencyCode={currencyCode}
            insights={resolved}
            inputRef={inputRef}
            onClose={close}
          />
        </InstantSearch>
      </SearchDrawer>
    </>
  )
}

export default Search
