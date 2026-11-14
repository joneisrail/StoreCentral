import { FetchError } from "@medusajs/js-sdk"
import { useMutation, UseMutationOptions } from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { ORDER_VIEW_COUNTS_QUERY_KEY } from "./order-query-keys"
import { ordersQueryKeys } from "./orders"

type VoidLabelResponse = {
  order_id: string
  voided: { fulfillment_id: string }[]
}

export type MarkShippedPayload = {
  carrier: string
  tracking_number: string
  tracking_url?: string
  shipped_at?: string
  no_notification?: boolean
  location_id?: string
}

type MarkShippedResponse = { order_id: string; fulfillment_id: string }

const invalidateShippingQueries = (orderId: string) => {
  queryClient.invalidateQueries({ queryKey: ordersQueryKeys.lists() })
  queryClient.invalidateQueries({ queryKey: [ORDER_VIEW_COUNTS_QUERY_KEY] })
  queryClient.invalidateQueries({ queryKey: ordersQueryKeys.detail(orderId) })
  queryClient.invalidateQueries({ queryKey: ordersQueryKeys.preview(orderId) })
}

export const useVoidOrderLabel = (
  options?: UseMutationOptions<VoidLabelResponse, FetchError, { id: string }>
) => {
  return useMutation({
    mutationFn: ({ id }) =>
      sdk.client.fetch<VoidLabelResponse>(`/admin/orders/${id}/void-label`, {
        method: "POST",
      }),
    ...options,
    onSuccess: (data, variables, context) => {
      invalidateShippingQueries(variables.id)
      options?.onSuccess?.(data, variables, context)
    },
  })
}

export const useMarkOrderShipped = (
  options?: UseMutationOptions<
    MarkShippedResponse,
    FetchError,
    MarkShippedPayload & { id: string }
  >
) => {
  return useMutation({
    mutationFn: ({ id, ...body }) =>
      sdk.client.fetch<MarkShippedResponse>(
        `/admin/orders/${id}/mark-shipped`,
        { method: "POST", body }
      ),
    ...options,
    onSuccess: (data, variables, context) => {
      invalidateShippingQueries(variables.id)
      options?.onSuccess?.(data, variables, context)
    },
  })
}
