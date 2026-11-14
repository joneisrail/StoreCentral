import { Button, Input, Text } from "@medusajs/ui"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { DataTableFilter } from "../../../../../../components/table/data-table/data-table-filter"
import type { useTabTableQuery } from "../use-tab-table-query"
import { useTabFilters } from "./tab-filter-definitions"

// A select and its free-text twin filter the same thing; picking one drops the other.
const EXCLUSIVE_PAIRS = [
  ["country", "country_other"],
  ["carrier", "carrier_other"],
]

type TabTableToolbarProps = {
  /** The tab table's URL prefix (the same one given to `useTabTableQuery`). */
  prefix: string
  query: ReturnType<typeof useTabTableQuery>
  /** State of the `useOrderSearch` request made for `query.searchParams`. */
  searchState: {
    truncated: boolean
    isError: boolean
    refetch: () => unknown
  }
  /** Filter names (without the `f_` prefix) the tab already fixes. */
  excludeFilters?: string[]
}

export const TabTableToolbar = ({
  prefix,
  query,
  searchState,
  excludeFilters,
}: TabTableToolbarProps) => {
  const { t } = useTranslation()
  const filters = useTabFilters(excludeFilters)
  // The filter bar keeps its chips in local state; remounting it is how
  // "Clear all" drops them.
  const [resetCount, setResetCount] = useState(0)
  const [clearing, setClearing] = useState(false)

  // Remount only once the URL no longer holds the filters, or the fresh bar
  // would read them back as chips.
  useEffect(() => {
    if (clearing && !query.hasUserCriteria) {
      setClearing(false)
      setResetCount((n) => n + 1)
    }
  }, [clearing, query.hasUserCriteria])

  // Mutual exclusion: when both twins hold a value, the one that just changed
  // wins and the other is removed (and its chip dropped once the URL agrees).
  const { filters: activeValues, removeFilter } = query
  const previous = useRef(activeValues)
  const [dropped, setDropped] = useState<string[]>([])
  useEffect(() => {
    const before = previous.current
    previous.current = activeValues
    for (const [a, b] of EXCLUSIVE_PAIRS) {
      if (!activeValues[a] || !activeValues[b]) {
        continue
      }
      const aChanged = before[a]?.join() !== activeValues[a].join()
      const loser = aChanged ? b : a
      removeFilter(loser)
      setDropped((d) => [...d, loser])
    }
  }, [activeValues, removeFilter])
  useEffect(() => {
    if (dropped.length && dropped.every((k) => !activeValues[k])) {
      setDropped([])
      setResetCount((n) => n + 1)
    }
  }, [dropped, activeValues])

  const showClearAll = query.hasUserCriteria || query.search.trim().length > 0

  return (
    <div className="flex flex-col gap-y-2 px-6 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full max-w-[420px]">
          <Input
            type="search"
            size="small"
            maxLength={100}
            value={query.search}
            placeholder={t("orders.list.searchPlaceholder")}
            aria-label={t("orders.list.searchPlaceholder")}
            onChange={(e) => query.setSearch(e.target.value)}
          />
        </div>
        <DataTableFilter
          key={resetCount}
          filters={filters}
          prefix={prefix}
          hideClearAll
        />
        {showClearAll && (
          <Button
            size="small"
            variant="transparent"
            onClick={() => {
              query.clearAll()
              setClearing(true)
            }}
          >
            {t("orders.list.clearAll")}
          </Button>
        )}
      </div>
      {query.invalidFilters.includes("country_other") && (
        <Text size="small" className="text-ui-fg-error" role="alert">
          {t("orders.list.filters.countryInvalid")}
        </Text>
      )}
      {searchState.isError && (
        <div role="alert" className="flex items-center gap-x-2">
          <Text size="small" className="text-ui-fg-error">
            {t("orders.list.searchError")}
          </Text>
          <Button
            size="small"
            variant="secondary"
            onClick={() => searchState.refetch()}
          >
            {t("orders.list.searchRetry")}
          </Button>
        </div>
      )}
      {!searchState.isError && searchState.truncated && (
        <Text size="small" className="text-ui-fg-subtle" role="status">
          {t("orders.list.searchTruncated")}
        </Text>
      )}
    </div>
  )
}
