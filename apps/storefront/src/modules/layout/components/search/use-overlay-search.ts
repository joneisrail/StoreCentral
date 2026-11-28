"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useInstantSearch, useSearchBox } from "react-instantsearch"

import type { ProductHit } from "./rows"

export const DEBOUNCE_MS = 200

export type Mode = "suggest" | "loading" | "error" | "empty" | "results"

type OverlayResults = {
  _state?: { query?: string }
  hits?: ProductHit[]
  facets?: { name: string; data?: Record<string, number> }[]
}

/**
 * The input value, debounced into InstantSearch, and what the overlay should
 * show for it. Results count only once they belong to the latest query, so a
 * slower response for an earlier keystroke never stands in for the current one.
 */
export function useOverlaySearch() {
  const timer = useRef<number | undefined>(undefined)
  const queryHook = useCallback(
    (next: string, search: (value: string) => void) => {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => search(next), DEBOUNCE_MS)
    },
    []
  )
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const { query, refine } = useSearchBox({ queryHook })
  // `catchError` registers an error listener; without one InstantSearch
  // re-throws a failed search as an unhandled rejection.
  const { status, results: raw } = useInstantSearch({ catchError: true })
  const results = raw as unknown as OverlayResults | undefined

  const [value, setValue] = useState(query)
  const typed = value.trim()

  // The error check comes before the query comparison: a failed search never
  // renders the widgets, so `query` keeps its previous value and would leave
  // the overlay on "Searching…". The next search moves the status off "error".
  const mode: Mode = !typed
    ? "suggest"
    : status === "error"
      ? "error"
      : typed !== query.trim()
        ? "loading"
        : (results?._state?.query ?? "") !== query
          ? "loading"
          : results?.hits?.length
            ? "results"
            : "empty"

  return {
    value,
    typed,
    mode,
    onChange: (next: string) => {
      setValue(next)
      refine(next)
    },
    hits: results?.hits,
    facets: results?.facets,
  }
}
