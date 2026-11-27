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
