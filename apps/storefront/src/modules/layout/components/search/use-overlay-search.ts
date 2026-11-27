"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useInstantSearch, useSearchBox } from "react-instantsearch"

import type { ProductHit } from "./rows"

export const DEBOUNCE_MS = 200

export type Mode = "suggest" | "loading" | "error" | "empty" | "results"

type OverlayResults = {
  _state?: { query?: string }
  hits?: ProductHit[]
  nbHits?: number
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
  const { status, results: raw } = useInstantSearch()
  const results = raw as unknown as OverlayResults | undefined

  const [value, setValue] = useState(query)
  const typed = value.trim()

  const mode: Mode = !typed
    ? "suggest"
    : typed !== query.trim()
      ? "loading"
      : status === "error"
        ? "error"
        : (results?._state?.query ?? "") !== query
          ? "loading"
          : results?.hits?.length
            ? "results"
            : "empty"

  const settled = mode === "results" || mode === "empty"

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
    /** The result count for `typed`, or null while it isn't known. */
    count: settled ? results?.nbHits ?? results?.hits?.length ?? 0 : null,
  }
}
