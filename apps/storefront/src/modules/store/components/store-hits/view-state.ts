import type { IndexUiState, UiState } from "instantsearch.js"

export type CatalogView = "grid" | "list"

export const VIEW_PARAM = "view"

export type CatalogRoute = IndexUiState & { view?: "list" }

/** Anything but the exact string "list" is the default grid. */
export const parseView = (value: unknown): CatalogView =>
  value === "list" ? "list" : "grid"

export const readViewFromSearch = (search: string): CatalogView =>
  parseView(new URLSearchParams(search).get(VIEW_PARAM))

/**
 * Sets or drops the `view` param on a URL, leaving every other param and the
 * hash untouched. The default grid is omitted.
 */
export const applyViewToUrl = (url: string, view: CatalogView): string => {
  const parsed = new URL(url)

  if (view === "list") {
    parsed.searchParams.set(VIEW_PARAM, "list")
  } else {
    parsed.searchParams.delete(VIEW_PARAM)
  }

  return parsed.toString()
}

/**
 * `push` for the history router. The router builds its URL when a write is
 * scheduled but pushes it 400ms later, so a view toggled in between would be
 * lost; re-applying the current view at push time closes that window.
 */
export const createPush =
  (getView: () => CatalogView) =>
  (url: string): void => {
    window.history.pushState(null, "", applyViewToUrl(url, getView()))
  }

/**
 * InstantSearch routing state mapping that carries `view` as a top-level
 * route key. InstantSearch UI state has no `view`, so it is read from the
 * caller on every write and dropped again when the route is read back.
 */
export const createStateMapping = (
  indexName: string,
  getView: () => CatalogView
) => ({
  stateToRoute(uiState: UiState): CatalogRoute {
    // `configure` (hitsPerPage) is set by the page, not the visitor.
    const { configure: _configure, ...state } = uiState[indexName] ?? {}
    const route: CatalogRoute = { ...state }

    if (getView() === "list") {
      route.view = "list"
    }

    return route
  },
  routeToState(routeState: CatalogRoute): UiState {
    const {
      [VIEW_PARAM]: _view,
      configure: _configure,
      ...rest
    } = routeState

    return { [indexName]: rest as IndexUiState }
  },
})
