import { useQueries } from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import {
  getViewQuery,
  ORDER_VIEW_ORDER,
  OrderListView,
} from "../../routes/orders/order-list/order-views"
import {
  ORDER_VIEW_COUNTS_QUERY_KEY,
  useHeldOrderIds,
  useHoldTag,
} from "./order-holds"

const COUNTS_STALE_TIME = 30_000

export type OrderViewCounts = Record<OrderListView, number | null>

/**
 * One `limit=1, fields=id` list request per tab; the response's `count` is
 * the tab's badge. A tab whose request fails yields `null`. Waits for the
 * hold tag and held ids so the Ready to Ship / Awaiting Payment counts are
 * never computed without the held-order exclusion; if either lookup
 * failed those tabs are `null`.
 */
export const useOrderViewCounts = () => {
  const { tagId, isLoading: tagLoading, isError: tagError } = useHoldTag()
  const { ids, isLoading: heldLoading, isError: heldError } = useHeldOrderIds()
  const ready = !tagLoading && !heldLoading

  // A failed (or truncated) lookup must not silently drop the exclusion:
  // the views that depend on it report `null` instead of a wrong count.
  const blocked: Partial<Record<OrderListView, boolean>> = {
    "on-hold": tagError,
    "ready-to-ship": tagError || heldError,
    "awaiting-payment": tagError || heldError,
  }

  const results = useQueries({
    queries: ORDER_VIEW_ORDER.map((view) => {
      const query = {
        ...getViewQuery(view, { heldIds: ids, holdTagId: tagId }),
        limit: 1,
        fields: "id",
      }

      return {
        queryKey: [ORDER_VIEW_COUNTS_QUERY_KEY, view, query],
        queryFn: () => sdk.admin.order.list(query as any),
        enabled: ready && !blocked[view],
        staleTime: COUNTS_STALE_TIME,
        retry: false,
      }
    }),
  })

  const counts = {} as OrderViewCounts
  ORDER_VIEW_ORDER.forEach((view, i) => {
    const r = results[i]
    counts[view] =
      blocked[view] || r.isError || r.data === undefined ? null : r.data.count
  })

  return {
    counts,
    isLoading: !ready || results.some((r) => r.isLoading),
    refetch: () => Promise.all(results.map((r) => r.refetch())),
  }
}
