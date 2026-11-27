import type { IndexUiState, UiState } from "instantsearch.js"

import {
  type CatalogRoute,
  createStateMapping,
} from "@modules/store/components/store-hits/view-state"

export const MAX_QUERY_LENGTH = 200
export const QUERY_PARAM = "q"
export const MIN_TRACKED_LENGTH = 3

/** Trimmed and capped search text from a raw `q` search param. */
export const normalizeQuery = (raw: string | string[] | undefined): string => {
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === "string"
    ? value.trim().slice(0, MAX_QUERY_LENGTH).trim()
    : ""
}

/**
 * The /store state mapping with the text query carried as `q` instead of
 * InstantSearch's `query`, so every refinement param stays compatible.
 */
export const createSearchStateMapping = (
  indexName: string,
  getView: Parameters<typeof createStateMapping>[1]
) => {
  const base = createStateMapping(indexName, getView)

  return {
    stateToRoute(uiState: UiState): CatalogRoute & { q?: string } {
      const { query, ...rest } = base.stateToRoute(uiState)
      return query ? { ...rest, [QUERY_PARAM]: query } : rest
    },
    routeToState(route: CatalogRoute & { q?: string }): UiState {
      const { [QUERY_PARAM]: q, ...rest } = route
      const state = base.routeToState(rest as CatalogRoute)
      const index = (state[indexName] ?? {}) as IndexUiState
      return {
        [indexName]: typeof q === "string" ? { ...index, query: q } : index,
      }
    },
  }
}

const REFINEMENT_KEYS = [
  "facetsRefinements",
  "facetsExcludes",
  "disjunctiveFacetsRefinements",
  "hierarchicalFacetsRefinements",
  "numericRefinements",
  "tagRefinements",
] as const

const isEmptyEntry = (value: unknown): boolean => {
  if (value == null) {
    return true
  }
  if (Array.isArray(value)) {
    return value.every(isEmptyEntry)
  }
  if (typeof value === "object") {
    return Object.values(value).every(isEmptyEntry)
  }
  return false
}

/**
 * Whether a result set's own helper state (`results._state`) carried no
 * refinements, i.e. its hit count is the query's unfiltered count. An absent
 * state is not provably unrefined, so it is false.
 */
export const isUnrefinedState = (state: unknown): boolean => {
  if (!state || typeof state !== "object") {
    return false
  }
  const record = state as Record<string, unknown>
  return REFINEMENT_KEYS.every((key) => isEmptyEntry(record[key]))
}
