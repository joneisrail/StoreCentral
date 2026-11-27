"use client"

import { MagnifyingGlass, XMark } from "@medusajs/icons"
import { useRouter } from "next/navigation"
import {
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react"

import { navReducer } from "@lib/util/combobox-nav"
import {
  addRecentSearch,
  clearRecentSearches,
  getRecentSearches,
  removeRecentSearch,
} from "@lib/util/recent-searches"
import ResultsList from "./results-list"
import {
  resultSections,
  searchHref,
  suggestionSections,
  type Row,
  type SearchInsights,
} from "./rows"
import Suggestions from "./suggestions"
import { useOverlaySearch } from "./use-overlay-search"

export { DEBOUNCE_MS } from "./use-overlay-search"

export const SEARCH_ERROR_TEXT =
  "Search is unavailable right now. Please try again."

type SearchOverlayProps = {
  currencyCode: string
  insights: SearchInsights | null
  inputRef: RefObject<HTMLInputElement | null>
  onClose: () => void
}

const SearchOverlay = ({
  currencyCode,
  insights,
  inputRef,
  onClose,
}: SearchOverlayProps) => {
  const router = useRouter()
  const prefix = useId()
  const listboxId = `${prefix}-listbox`
  const done = useRef(false)
  const { value, typed, mode, onChange, hits, facets } = useOverlaySearch()
  const [recent, setRecent] = useState<string[]>(getRecentSearches)

  const sections = useMemo(() => {
    if (mode === "suggest") {
      return suggestionSections(prefix, {
        recent,
        popular: insights?.popular ?? null,
        trending: insights?.trending ?? null,
      })
    }
    if (mode === "results") {
      return resultSections(prefix, { query: typed, hits: hits ?? [], facets })
    }
    return []
  }, [mode, prefix, recent, insights, typed, hits, facets])

  const rows = useMemo(() => sections.flatMap((s) => s.rows), [sections])
  const [nav, dispatch] = useReducer(navReducer, { active: -1, count: 0 })
  useEffect(() => dispatch({ type: "count", count: rows.length }), [rows])
  useEffect(() => dispatch("reset"), [typed])

  const activeRow: Row | undefined = rows[nav.active]
  const activeId = activeRow?.id

  useEffect(() => {
    if (activeId) {
      document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" })
    }
  }, [activeId])

  /**
   * Records a chosen query once as a recent search. Analytics are left to the
   * /search page, the one place that knows every search's true result count.
   */
  const finish = (q: string | undefined, href: string, navigate: boolean) => {
    if (done.current) {
      return
    }
    done.current = true
    if (q) {
      addRecentSearch(q)
    }
    onClose()
    if (navigate) {
      router.push(href)
    }
  }

  const onSelect = (row: Row) => finish(row.record, row.href, false)

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Keys pressed while an IME composes text belong to the composition.
    if (event.nativeEvent.isComposing) {
      return
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault()
        dispatch("next")
        break
      case "ArrowUp":
        event.preventDefault()
        dispatch("prev")
        break
      case "Enter":
        event.preventDefault()
        if (activeRow) {
          finish(activeRow.record, activeRow.href, true)
        } else if (typed) {
          finish(typed, searchHref(typed), true)
        }
        break
      case "Escape":
        event.preventDefault()
        onClose()
        break
    }
  }

  const keepFocus = () => inputRef.current?.focus()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-x-3 border-b border-line px-4">
        <MagnifyingGlass className="shrink-0 text-warm-grey" />
        <input
          ref={inputRef}
          type="text"
          inputMode="search"
          enterKeyHint="search"
          role="combobox"
          aria-label="Search products"
          aria-autocomplete="list"
          aria-expanded={rows.length > 0}
          aria-controls={listboxId}
          aria-activedescendant={activeId}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search fragrances, brands, notes"
          className="min-w-0 flex-1 bg-transparent py-4 font-sans text-base text-charcoal outline-none placeholder:text-warm-grey"
          data-testid="search-input"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close search"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center text-warm-grey hover:text-charcoal focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-deep"
          data-testid="close-search"
        >
          <XMark />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {mode === "loading" && (
          <p
            role="status"
            className="px-4 py-6 text-center text-warm-grey"
            data-testid="search-loading"
          >
            Searching&hellip;
          </p>
        )}
        {mode === "error" && (
          <p
            role="alert"
            className="px-4 py-6 text-center text-charcoal"
            data-testid="search-error"
          >
            {SEARCH_ERROR_TEXT}
          </p>
        )}
        {mode === "empty" && (
          <p
            role="status"
            className="px-4 py-6 text-center text-warm-grey"
            data-testid="search-no-results"
          >
            No results for “{typed}”. Try another spelling or a brand name.
          </p>
        )}
        <div role="listbox" id={listboxId} aria-label="Search suggestions">
          {mode === "suggest" ? (
            <Suggestions
              sections={sections}
              activeId={activeId}
              onSelect={onSelect}
              onRemoveRecent={(q) => {
                setRecent(removeRecentSearch(q))
                keepFocus()
              }}
              onClearRecent={() => {
                clearRecentSearches()
                setRecent([])
                keepFocus()
              }}
            />
          ) : (
            <ResultsList
              sections={sections}
              activeId={activeId}
              onSelect={onSelect}
              currencyCode={currencyCode}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default SearchOverlay
