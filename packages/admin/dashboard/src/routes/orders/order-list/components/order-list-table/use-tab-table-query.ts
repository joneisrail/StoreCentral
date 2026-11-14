import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"

import {
  normalizeOrderSearchParams,
  OrderSearchParams,
} from "../../../../../hooks/api/order-search"

/** Matches no order; used when the user criteria exclude every row. */
export const NO_MATCH_ID = "__no_match__"
const SEARCH_DEBOUNCE_MS = 300

/** Filter keys. Their URL param is `${prefix}_f_<key>`. */
const LIST_KEYS = [
  "payment_status",
  "fulfillment_status",
  "sales_channel_id",
  "tag_id",
  "region_id",
] as const
const JSON_KEYS = ["created_at"] as const
// There is deliberately no total filter: the server compares order totals as
// text (see integration-tests/http/orders-total-filter.spec.ts).
/**
 * Keys holding a comma-separated list (multi-selects, and the single selects
 * whose values never contain commas). Every other key is free text and is
 * kept whole, commas included.
 */
const LIST_VALUE_KEYS: string[] = [
  ...LIST_KEYS,
  "country",
  "carrier",
  "ship_from",
]
const TEXT_KEYS = ["sku", "delivery", "country_other", "carrier_other"]

const ALL_FILTER_KEYS: string[] = [
  ...LIST_KEYS,
  ...JSON_KEYS,
  "country",
  "carrier",
  "ship_from",
  ...TEXT_KEYS,
]

const DATE_OPERATORS = ["$gte", "$lte", "$gt", "$lt"]

const filterParam = (prefix: string, key: string) => `${prefix}_f_${key}`

const parseOperatorMap = (
  raw: string | undefined,
  allowed: string[],
  coerce: (v: unknown) => unknown
): Record<string, unknown> | undefined => {
  if (!raw) {
    return undefined
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }

  // A bare number is an exact match (the number filter's "exact" mode).
  if (typeof parsed === "number" || typeof parsed === "string") {
    parsed = { $eq: parsed }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined
  }

  const out: Record<string, unknown> = {}
  for (const [op, value] of Object.entries(parsed)) {
    if (!allowed.includes(op) || value === "" || value == null) {
      continue
    }
    const coerced = coerce(value)
    if (coerced !== undefined) {
      out[op] = coerced
    }
  }

  return Object.keys(out).length ? out : undefined
}

const toDateString = (v: unknown) => {
  return typeof v === "string" ? v : undefined
}

const asList = (value: unknown): string[] => {
  if (value === undefined || value === null) {
    return []
  }
  return (Array.isArray(value) ? value : [value]).map(String)
}

const intersect = (a: string[], b: string[]) => a.filter((v) => b.includes(v))

export const useTabTableQuery = (prefix: string) => {
  const [params, setParams] = useSearchParams()

  const qKey = `${prefix}_q`
  const urlQ = params.get(qKey) ?? ""

  // The input is local so typing is instant; only the debounced value enters
  // the URL (and so the request).
  const [input, setInput] = useState(urlQ)
  const lastWritten = useRef(urlQ)

  useEffect(() => {
    // The URL changed from outside (back/forward, Clear all): follow it.
    if (urlQ !== lastWritten.current) {
      lastWritten.current = urlQ
      setInput(urlQ)
    }
  }, [urlQ])

  useEffect(() => {
    const next = input.trim()
    if (next === lastWritten.current) {
      return
    }

    const id = setTimeout(() => {
      lastWritten.current = next
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev)
          if (next) {
            out.set(qKey, next)
          } else {
            out.delete(qKey)
          }
          return out
        },
        { replace: true }
      )
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(id)
  }, [input, qKey, setParams])

  const filterSignature = JSON.stringify(
    ALL_FILTER_KEYS.map((key) => params.get(filterParam(prefix, key)) ?? "")
  )

  const filters = useMemo(() => {
    const raws = JSON.parse(filterSignature) as string[]
    const out: Record<string, string[]> = {}
    ALL_FILTER_KEYS.forEach((key, i) => {
      const raw = raws[i]
      if (!raw) {
        return
      }
      const values = LIST_VALUE_KEYS.includes(key)
        ? raw.split(",").filter(Boolean)
        : [raw]
      if (values.length) {
        out[key] = values
      }
    })
    return out
  }, [filterSignature])

  const setFilter = useCallback(
    (key: string, values: string[]) => {
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev)
          const value = LIST_VALUE_KEYS.includes(key)
            ? values.filter(Boolean).join(",")
            : (values[0] ?? "")
          if (value) {
            out.set(filterParam(prefix, key), value)
          } else {
            out.delete(filterParam(prefix, key))
          }
          return out
        },
        { replace: true }
      )
    },
    [prefix, setParams]
  )

  const removeFilter = useCallback(
    (key: string) => setFilter(key, []),
    [setFilter]
  )

  const clearAll = useCallback(() => {
    lastWritten.current = ""
    setInput("")
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev)
        out.delete(qKey)
        ALL_FILTER_KEYS.forEach((key) => out.delete(filterParam(prefix, key)))
        return out
      },
      { replace: true }
    )
  }, [prefix, qKey, setParams])

  // Search-route params: the backend resolves these to order ids.
  const searchParams: OrderSearchParams = useMemo(() => {
    const first = (key: string) => filters[key]?.[0]
    return normalizeOrderSearchParams({
      q: urlQ,
      sku: first("sku"),
      country: first("country") ?? first("country_other"),
      carrier: first("carrier") ?? first("carrier_other"),
      ship_from: first("ship_from"),
      delivery: first("delivery"),
    })
  }, [urlQ, filters])

  const hasSearchCriteria = Object.keys(searchParams).length > 0

  const directCriteria = useMemo(() => {
    const out: Record<string, unknown> = {}
    for (const key of LIST_KEYS) {
      if (filters[key]?.length) {
        out[key] = filters[key]
      }
    }
    const createdAt = parseOperatorMap(
      filters.created_at?.[0],
      DATE_OPERATORS,
      toDateString
    )
    if (createdAt) {
      out.created_at = createdAt
    }
    return out
  }, [filters])

  // Free-text country chips that would silently search nothing.
  const invalidFilters = useMemo(() => {
    const other = filters.country_other?.[0]
    return other && !/^[A-Za-z]{2}$/.test(other.trim()) ? ["country_other"] : []
  }, [filters])

  // Every visible chip counts, so Clear all never hides while one shows.
  const hasUserCriteria =
    hasSearchCriteria ||
    Object.keys(directCriteria).length > 0 ||
    Object.keys(filters).length > 0

  /** Changes whenever the active criteria do; tables reset their offset on it. */
  const criteriaKey = useMemo(
    () => JSON.stringify({ s: searchParams, d: directCriteria }),
    [searchParams, directCriteria]
  )

  /**
   * Merges the user criteria into a tab's own query. Narrow-only: nothing the
   * user picks can widen what the tab lists. `orderIds` are the ids returned
   * by `useOrderSearch` for `searchParams` (null while unknown or failed,
   * which lists nothing rather than everything).
   */
  const toOrdersQuery = useCallback(
    (
      baseTabQuery: Record<string, unknown>,
      orderIds: string[] | null
    ): Record<string, unknown> => {
      const query: Record<string, unknown> = { ...baseTabQuery }
      const noMatch = { ...query, id: NO_MATCH_ID }

      for (const key of [
        "payment_status",
        "fulfillment_status",
        "sales_channel_id",
        "region_id",
      ] as const) {
        const user = directCriteria[key] as string[] | undefined
        if (!user) {
          continue
        }
        const tab = baseTabQuery[key]
        const merged = tab === undefined ? user : intersect(asList(tab), user)
        if (!merged.length) {
          return noMatch
        }
        query[key] = merged
      }

      // A tab that is itself defined by a tag (On Hold) keeps it: a user tag
      // filter can only narrow, and one list cannot express "both tags".
      if (directCriteria.tag_id && baseTabQuery.tag_id === undefined) {
        query.tag_id = directCriteria.tag_id
      }
      if (directCriteria.created_at && baseTabQuery.created_at === undefined) {
        query.created_at = directCriteria.created_at
      }

      if (hasSearchCriteria) {
        const tabId = baseTabQuery.id
        if (typeof tabId === "string") {
          // A sentinel such as "__no_hold_tag__" already matches nothing.
          return query
        }
        const excluded = new Set<string>(
          ((tabId as { $nin?: string[] } | undefined)?.$nin ?? []).map(String)
        )
        const ids = (orderIds ?? []).filter((id) => !excluded.has(id))
        if (!ids.length) {
          return noMatch
        }
        query.id = { $in: ids }
      }

      return query
    },
    [directCriteria, hasSearchCriteria]
  )

  return {
    search: input,
    setSearch: setInput,
    filters,
    setFilter,
    removeFilter,
    clearAll,
    hasUserCriteria,
    hasSearchCriteria,
    invalidFilters,
    criteriaKey,
    toOrdersQuery,
    searchParams,
  }
}
