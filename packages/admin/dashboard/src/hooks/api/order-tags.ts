import {
  AdminCreateOrderTag,
  AdminOrderTagDeleteResponse,
  AdminOrderTagListParams,
  AdminOrderTagListResponse,
  AdminOrderTagResponse,
  AdminUpdateOrderTag,
  FetchError,
} from "@medusajs/js-sdk"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { orderTagsQueryKeys } from "./order-query-keys"
import { ordersQueryKeys } from "./orders"

export { orderTagsQueryKeys }

export const useOrderTags = (
  query?: AdminOrderTagListParams,
  options?: Omit<
    UseQueryOptions<
      AdminOrderTagListResponse,
      FetchError,
      AdminOrderTagListResponse,
      QueryKey
    >,
    "queryKey" | "queryFn"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => sdk.admin.orderTags.list(query),
    queryKey: orderTagsQueryKeys.list(query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useCreateOrderTag = (
  options?: UseMutationOptions<
    AdminOrderTagResponse,
    FetchError,
    AdminCreateOrderTag
  >
) => {
  return useMutation({
    mutationFn: (payload) => sdk.admin.orderTags.create(payload),
    ...options,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: orderTagsQueryKeys.lists(),
      })

      options?.onSuccess?.(data, variables, context)
    },
  })
}

export const useUpdateOrderTag = (
  id: string,
  options?: UseMutationOptions<
    AdminOrderTagResponse,
    FetchError,
    AdminUpdateOrderTag
  >
) => {
  return useMutation({
    mutationFn: (payload) => sdk.admin.orderTags.update(id, payload),
    ...options,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: orderTagsQueryKeys.lists(),
      })

      options?.onSuccess?.(data, variables, context)
    },
  })
}

export const useDeleteOrderTag = (
  id: string,
  options?: UseMutationOptions<AdminOrderTagDeleteResponse, FetchError, void>
) => {
  return useMutation({
    mutationFn: () => sdk.admin.orderTags.delete(id),
    ...options,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: orderTagsQueryKeys.lists(),
      })

      options?.onSuccess?.(data, variables, context)
    },
  })
}

export const useBulkTagOrders = (
  options?: UseMutationOptions<
    { order_ids: string[] },
    FetchError,
    {
      order_ids: string[]
      add?: string[]
      remove?: string[]
    }
  >
) => {
  return useMutation({
    mutationFn: (payload) => sdk.admin.order.bulkTag(payload),
    ...options,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: ordersQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: orderTagsQueryKeys.lists() })

      options?.onSuccess?.(data, variables, context)
    },
  })
}
