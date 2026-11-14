import { FetchError } from "@medusajs/js-sdk"
import { useQuery } from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const ORDER_SEARCH_QUERY_KEY = "order-search" as const
export const orderSearchQueryKeys = queryKeysFactory(ORDER_SEARCH_QUERY_KEY)

const SEARCH_STALE_TIME = 30_000
const MAX_LENGTH = 100
export const MIN_SEARCH_LENGTH = 2

export type OrderSearchParams = {
  q?: string
  sku?: string
  country?: string
  carrier?: string
  ship_from?: string
  delivery?: string
}

type OrderSearchResponse = { order_ids: string[]; truncated: boolean }

/**
 * Trims every param and drops the inactive ones: blank values, a `q` shorter
 * than two characters (not searched) and a `country` that is not two letters.
 */
export const normalizeOrderSearchParams = (
  params: OrderSearchParams
): OrderSearchParams => {
  const out: OrderSearchParams = {}

  for (const key of [
    "q",
    "sku",
    "country",
    "carrier",
    "ship_from",
    "delivery",
  ] as const) {
    const raw = params[key]
    if (typeof raw !== "string") {
      continue
    }

    const value = raw.slice(0, MAX_LENGTH).trim()
    if (!value) {
      continue
    }
    if (key === "q" && value.length < MIN_SEARCH_LENGTH) {
      continue
    }
    if (key === "country" && !/^[A-Za-z]{2}$/.test(value)) {
      continue
    }

    out[key] = key === "country" ? value.toUpperCase() : value
  }

  return out
}

export const useOrderSearch = (
  params: OrderSearchParams,
  options?: { enabled?: boolean }
) => {
  const normalized = normalizeOrderSearchParams(params)
  const active = Object.keys(normalized).length > 0

  const { data, isLoading, isError, refetch } = useQuery<
    OrderSearchResponse,
    FetchError
  >({
    queryKey: orderSearchQueryKeys.list(normalized),
    queryFn: () =>
      sdk.client.fetch<OrderSearchResponse>("/admin/order-search", {
        query: normalized,
      }),
    enabled: active && (options?.enabled ?? true),
    retry: false,
    staleTime: SEARCH_STALE_TIME,
  })

  return {
    orderIds: active && data ? data.order_ids : null,
    truncated: active && !!data?.truncated,
    isLoading: active && isLoading,
    isError: active && isError,
    refetch,
  }
}
