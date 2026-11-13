import { FetchError } from "@medusajs/js-sdk"
import {
  useMutation,
  UseMutationOptions,
  useQuery,
} from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"
import { orderTagsQueryKeys, useOrderTags } from "./order-tags"
import { ordersQueryKeys } from "./orders"

export const HOLD_TAG_VALUE = "On hold"
const HELD_IDS_LIMIT = 500

export const orderHeldIdsQueryKeys = queryKeysFactory("order-held-ids")
// Defined here (not in the counts hook) so the mutations below can
// invalidate it without a circular import.
export const ORDER_VIEW_COUNTS_QUERY_KEY = "order-view-counts" as const

export const useHoldTag = (): { tagId: string | null; isLoading: boolean } => {
  const { order_tags, isLoading } = useOrderTags({
    value: HOLD_TAG_VALUE,
    limit: 100,
  } as any)

  const tag = order_tags?.find((t) => t.value === HOLD_TAG_VALUE)

  return { tagId: tag?.id ?? null, isLoading }
}

export const useHeldOrderIds = (): { ids: string[]; isLoading: boolean } => {
  const { tagId, isLoading: tagLoading } = useHoldTag()

  const { data, isLoading } = useQuery({
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

  return {
    ids: tagId ? (data?.orders ?? []).map((o) => o.id) : [],
    isLoading: tagLoading || (!!tagId && isLoading),
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
