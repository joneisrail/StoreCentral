import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"

import { useOrderSearch } from "../../../../../hooks/api/order-search"
import { useTabTableQuery } from "./use-tab-table-query"

/**
 * Everything a tab table needs to apply the toolbar's search and filters:
 * the tab's own query narrowed by the user's criteria, the paging offset
 * (reset whenever the criteria change), and whether rows may be requested.
 * Counts never use this; they always use the tab's own query.
 */
export const useTabTableCriteria = (
  prefix: string,
  baseTabQuery: Record<string, unknown>
) => {
  const [urlParams, setUrlParams] = useSearchParams()
  const query = useTabTableQuery(prefix)
  const search = useOrderSearch(query.searchParams)

  const { criteriaKey } = query
  const offsetParam = `${prefix}_offset`

  // The criteria key the URL offset belongs to. When the criteria move on,
  // the old offset is meaningless: use 0 straight away and drop the param.
  const [offsetKeyOwner, setOffsetKeyOwner] = useState(criteriaKey)
  useEffect(() => {
    if (offsetKeyOwner === criteriaKey) {
      return
    }
    setOffsetKeyOwner(criteriaKey)
    setUrlParams(
      (prev) => {
        if (!prev.has(offsetParam)) {
          return prev
        }
        const out = new URLSearchParams(prev)
        out.delete(offsetParam)
        return out
      },
      { replace: true }
    )
  }, [criteriaKey, offsetKeyOwner, offsetParam, setUrlParams])

  const offset =
    offsetKeyOwner === criteriaKey ? Number(urlParams.get(offsetParam) ?? 0) : 0

  const ordersQuery = query.hasUserCriteria
    ? query.toOrdersQuery(baseTabQuery, search.orderIds)
    : baseTabQuery

  return {
    ordersQuery,
    offset,
    /** Do not request or list rows: the search is loading or failed. */
    searchBlocked: search.isLoading || search.isError,
    searchLoading: search.isLoading,
    toolbarProps: { prefix, query, searchState: search },
  }
}
