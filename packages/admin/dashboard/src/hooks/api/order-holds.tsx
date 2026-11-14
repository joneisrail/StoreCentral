import { FetchError } from "@medusajs/js-sdk"
import {
  useMutation,
  UseMutationOptions,
  useQuery,
} from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { orderTagsQueryKeys, useOrderTags } from "./order-tags"
import {
  HOLD_TAG_VALUE,
  ORDER_VIEW_COUNTS_QUERY_KEY,
  orderHeldIdsQueryKeys,
} from "./order-query-keys"
import { ordersQueryKeys } from "./orders"

const HELD_IDS_LIMIT = 500

export const useHoldTag = (): {
  tagId: string | null
  isLoading: boolean
  isError: boolean
} => {
  const { order_tags, isLoading, isError } = useOrderTags({
    value: HOLD_TAG_VALUE,
    limit: 100,
  } as any)

  const tag = order_tags?.find((t) => t.value === HOLD_TAG_VALUE)

  return { tagId: tag?.id ?? null, isLoading, isError }
}

/**
 * Ids of the held (tagged, non-canceled) orders, used to exclude them from
 * the Ready to Ship / Awaiting Payment views.
 *
 * Only the first `HELD_IDS_LIMIT` (500) ids are fetched. If the tag matches
 * more orders than that the exclusion would be incomplete, so `isError` is
 * reported (and callers must not list or count those views) rather than
 * silently showing held orders.
 */
export const useHeldOrderIds = (): {
  ids: string[]
  isLoading: boolean
  isError: boolean
} => {
  const { tagId, isLoading: tagLoading, isError: tagError } = useHoldTag()

  const { data, isLoading, isError } = useQuery({
    queryKey: orderHeldIdsQueryKeys.list({ tagId }),
    queryFn: () =>
      sdk.admin.order.list({
        tag_id: tagId as string,
        status: { $nin: ["canceled"] },
        fields: "id",
        limit: HELD_IDS_LIMIT,
      } as any),
    enabled: !!tagId,
  })

  const ids = tagId ? (data?.orders ?? []).map((o) => o.id) : []
  const truncated = !!tagId && !!data && (data.count ?? 0) > ids.length

  return {
    ids,
    isLoading: tagLoading || (!!tagId && isLoading),
    isError: tagError || (!!tagId && isError) || truncated,
  }
}

type HoldResponse = { order_id: string; on_hold: boolean }

const invalidateHoldQueries = () => {
  queryClient.invalidateQueries({ queryKey: ordersQueryKeys.lists() })
  queryClient.invalidateQueries({ queryKey: [ORDER_VIEW_COUNTS_QUERY_KEY] })
  queryClient.invalidateQueries({ queryKey: orderHeldIdsQueryKeys.all })
  queryClient.invalidateQueries({ queryKey: orderTagsQueryKeys.all })
}

export const useHoldOrder = (
  options?: UseMutationOptions<
    HoldResponse,
    FetchError,
    { id: string; reason: string }
  >
) => {
  return useMutation({
    mutationFn: ({ id, reason }) =>
      sdk.client.fetch<HoldResponse>(`/admin/orders/${id}/hold`, {
        method: "POST",
        body: { reason },
      }),
    ...options,
    onSuccess: (data, variables, context) => {
      invalidateHoldQueries()
      options?.onSuccess?.(data, variables, context)
    },
  })
}

export const useReleaseOrder = (
  options?: UseMutationOptions<HoldResponse, FetchError, { id: string }>
) => {
  return useMutation({
    mutationFn: ({ id }) =>
      sdk.client.fetch<HoldResponse>(`/admin/orders/${id}/release`, {
        method: "POST",
      }),
    ...options,
    onSuccess: (data, variables, context) => {
      invalidateHoldQueries()
      options?.onSuccess?.(data, variables, context)
    },
  })
}
