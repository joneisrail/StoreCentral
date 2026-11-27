import {
  parseView,
  VIEW_PARAM,
  type CatalogView,
} from "@modules/store/components/store-hits/view-state"

export type SearchParamsRecord = Record<string, string | string[] | undefined>

const GRID_CLASSES =
  "grid grid-cols-2 w-full small:grid-cols-3 medium:grid-cols-4 gap-x-6 gap-y-8"
const LIST_CLASSES = "grid grid-cols-1 w-full gap-x-6 gap-y-8"

export const gridClasses = (view: CatalogView): string =>
  parseView(view) === "list" ? LIST_CLASSES : GRID_CLASSES

/** Same path and params with `view` set; the default grid omits it. */
export const viewHref = (
  pathname: string,
  params: SearchParamsRecord,
  view: CatalogView
): string => {
  const query = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (key === VIEW_PARAM || value === undefined) continue

    for (const item of Array.isArray(value) ? value : [value]) {
      query.append(key, item)
    }
  }

  if (parseView(view) === "list") {
    query.set(VIEW_PARAM, "list")
  }

  const search = query.toString()

  return search ? `${pathname}?${search}` : pathname
}

export const viewHrefs = (
  pathname: string,
  params: SearchParamsRecord
): Record<CatalogView, string> => ({
  grid: viewHref(pathname, params, "grid"),
  list: viewHref(pathname, params, "list"),
})
