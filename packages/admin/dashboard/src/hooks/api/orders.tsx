import { FetchError } from "@medusajs/js-sdk"
import { CreateOrderCreditLineDTO, HttpTypes } from "@medusajs/types"
import {
  QueryKey,
  useMutation,
  UseMutationOptions,
  useQuery,
  UseQueryOptions,
} from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory, TQueryKey } from "../../lib/query-key-factory"
// Imported from `ready-to-ship-table.tsx`'s own re-export, not directly from
// `package-popover.tsx` - see that re-export's comment: this is exactly the
// case (Task 11) it exists for. A type-only import, so this doesn't create a
// real runtime dependency cycle with `ready-to-ship-table.tsx`, which itself
// imports `useOrderCarrierRates` (a value) from this file.
import type { PackageSelection } from "../../routes/orders/order-list/components/order-list-table/components/ready-to-ship-table"
import { inventoryItemsQueryKeys } from "./inventory"
import { reservationItemsQueryKeys } from "./reservations"

const ORDERS_QUERY_KEY = "orders" as const
const _orderKeys = queryKeysFactory(ORDERS_QUERY_KEY) as TQueryKey<"orders"> & {
  preview: (orderId: string) => any
  changes: (orderId: string) => any
  lineItems: (orderId: string, query?: any) => any
  shippingOptions: (orderId: string) => any
}

_orderKeys.preview = function (id: string) {
  return [this.detail(id), "preview"]
}

_orderKeys.changes = function (id: string) {
  return [this.detail(id), "changes"]
}

_orderKeys.lineItems = function (id: string, query?: any) {
  return [this.detail(id), query ? { query } : undefined, "lineItems"].filter(
    (k) => !!k
  )
}

_orderKeys.shippingOptions = function (id: string) {
  return [this.detail(id), "shippingOptions"]
}

export const ordersQueryKeys = _orderKeys

export const useOrder = (
  id: string,
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminOrderResponse,
      FetchError,
      HttpTypes.AdminOrderResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () => sdk.admin.order.retrieve(id, query),
    queryKey: ordersQueryKeys.detail(id, query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useUpdateOrder = (
  id: string,
  options?: UseMutationOptions<
    HttpTypes.AdminOrderResponse,
    FetchError,
    HttpTypes.AdminUpdateOrder
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminUpdateOrder) =>
      sdk.admin.order.update(id, payload),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.detail(id),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.changes(id),
      })

      // TODO: enable when needed
      // queryClient.invalidateQueries({
      //   queryKey: ordersQueryKeys.lists(),
      // })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useOrderPreview = (
  id: string,
  query?: HttpTypes.AdminOrderFilters,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminOrderPreviewResponse,
      FetchError,
      HttpTypes.AdminOrderPreviewResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () => sdk.admin.order.retrievePreview(id, query),
    queryKey: ordersQueryKeys.preview(id),
    ...options,
  })

  return { ...data, ...rest }
}

export const useOrders = (
  query?: HttpTypes.AdminOrderFilters,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminOrderListResponse,
      FetchError,
      HttpTypes.AdminOrderListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () => sdk.admin.order.list(query),
    queryKey: ordersQueryKeys.list(query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useOrderShippingOptions = (
  id: string,
  query?: HttpTypes.AdminGetOrderShippingOptionList,
  options?: Omit<
    UseQueryOptions<
      { shipping_options: HttpTypes.AdminShippingOption[] },
      FetchError,
      { shipping_options: HttpTypes.AdminShippingOption[] },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () => sdk.admin.order.listShippingOptions(id, query),
    queryKey: ordersQueryKeys.shippingOptions(id),
    ...options,
  })

  return { ...data, ...rest }
}

export const useOrderChanges = (
  id: string,
  query?: HttpTypes.AdminOrderChangesFilters,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminOrderChangesResponse,
      FetchError,
      HttpTypes.AdminOrderChangesResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () => sdk.admin.order.listChanges(id, query),
    queryKey: ordersQueryKeys.changes(id),
    ...options,
  })

  return { ...data, ...rest }
}

export const useOrderLineItems = (
  id: string,
  query?: HttpTypes.AdminOrderItemsFilters,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminOrderLineItemsListResponse,
      FetchError,
      HttpTypes.AdminOrderLineItemsListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () => sdk.admin.order.listLineItems(id, query),
    queryKey: ordersQueryKeys.lineItems(id, query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useCreateOrderFulfillment = (
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminOrderResponse,
    FetchError,
    HttpTypes.AdminCreateOrderFulfillment
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminCreateOrderFulfillment) =>
      sdk.admin.order.createFulfillment(orderId, payload),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.all,
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: reservationItemsQueryKeys.lists(),
      })

      queryClient.invalidateQueries({
        queryKey: inventoryItemsQueryKeys.details(),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

/**
 * The Bulk Fulfill Orders API route's response shape, reused as-is by
 * `BulkFulfillResultSummary` (the UI that renders it) rather than each
 * side redeclaring its own copy of the same shape. `label_pdf_url` is only
 * present when the provider can combine every successfully bought label
 * into a single PDF for the batch - `BulkFulfillResultSummary` renders its
 * "Print N labels" link only when it's present.
 */
export type BulkFulfillOrdersResult = {
  succeeded: string[]
  failed: BulkFulfillOrderFailure[]
  label_pdf_url?: string
}

/**
 * One order the batch route couldn't fulfill. `easypost_shipment_id` is set
 * only when a real label was already bought for the order before its
 * fulfillment failed to be recorded - the id the admin needs to recover (or
 * refund) that purchase instead of it being silently orphaned.
 */
export type BulkFulfillOrderFailure = {
  order_id: string
  error: string
  easypost_shipment_id?: string
}

/**
 * The payload shape for `useBulkFulfillOrders` below - one entry per order
 * to fulfill, each against the shipment/rate already quoted for it by
 * `useOrderCarrierRates` (Task 6) and picked via `ShippingRateSelect`
 * (Task 11). `location_id` is optional: omitted, the backend falls back to
 * the order's default ship-from location, the same fallback
 * `rowLocationOverride` itself defaults from in `ready-to-ship-table.tsx`.
 */
export type BulkFulfillOrdersPayload = {
  fulfillments: {
    order_id: string
    location_id?: string
    shipment_id: string
    rate_id: string
    no_notification?: boolean
  }[]
}

/**
 * Bulk-fulfills one or more orders in a single request, used by the Ready
 * to Ship table's "Fulfill selected" command bar action and (with a
 * one-item `fulfillments` array) `FulfillConfirmPopover`'s single-row
 * Fulfill action. Mirrors `useBulkTagOrders` (`hooks/api/order-tags.ts`): a
 * dedicated mutation hook wrapping the SDK's own `bulkFulfill` method,
 * invalidating the same query keys `useCreateOrderFulfillment` does on
 * success since this is the same underlying operation (fulfillment
 * creation) applied to one or many orders at once - including
 * `ordersQueryKeys.all` broadly, since a successful batch likely moves
 * some orders out of the Ready to Ship view entirely.
 *
 * Carrier-rate quotes live under their own `carrierRatesQueryKeys` root, so
 * that broad `ordersQueryKeys.all` invalidation doesn't re-quote every
 * visible row (which would replace every row's quote data and reset any
 * manually picked rate back to the cheapest). Only the quotes of the orders
 * that were part of THIS fulfill are invalidated - their quoted shipments
 * were bought, or failed to be.
 */
export const useBulkFulfillOrders = (
  options?: UseMutationOptions<
    BulkFulfillOrdersResult,
    FetchError,
    BulkFulfillOrdersPayload
  >
) => {
  return useMutation({
    mutationFn: (payload: BulkFulfillOrdersPayload) =>
      sdk.admin.order.bulkFulfill(payload),
    ...options,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.all,
      })

      queryClient.invalidateQueries({
        queryKey: reservationItemsQueryKeys.lists(),
      })

      queryClient.invalidateQueries({
        queryKey: inventoryItemsQueryKeys.details(),
      })

      for (const { order_id } of variables.fulfillments) {
        queryClient.invalidateQueries({
          queryKey: carrierRatesQueryKeys.order(order_id),
        })
      }

      options?.onSuccess?.(data, variables, context)
    },
  })
}

export const useCancelOrderFulfillment = (
  orderId: string,
  fulfillmentId: string,
  options?: UseMutationOptions<any, FetchError, any>
) => {
  return useMutation({
    mutationFn: (payload: { no_notification?: boolean }) =>
      sdk.admin.order.cancelFulfillment(orderId, fulfillmentId, payload),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.all,
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: reservationItemsQueryKeys.lists(),
      })

      queryClient.invalidateQueries({
        queryKey: inventoryItemsQueryKeys.details(),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useCreateOrderShipment = (
  orderId: string,
  fulfillmentId: string,
  options?: UseMutationOptions<
    { order: HttpTypes.AdminOrder },
    FetchError,
    HttpTypes.AdminCreateOrderShipment
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminCreateOrderShipment) =>
      sdk.admin.order.createShipment(orderId, fulfillmentId, payload),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.all,
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useMarkOrderFulfillmentAsDelivered = (
  orderId: string,
  fulfillmentId: string,
  options?: UseMutationOptions<
    { order: HttpTypes.AdminOrder },
    FetchError,
    HttpTypes.AdminMarkOrderFulfillmentAsDelivered
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminMarkOrderFulfillmentAsDelivered) =>
      sdk.admin.order.markAsDelivered(orderId, fulfillmentId, payload),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.all,
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useCancelOrder = (
  orderId: string,
  options?: UseMutationOptions<HttpTypes.AdminOrderResponse, FetchError, void>
) => {
  return useMutation({
    mutationFn: () => sdk.admin.order.cancel(orderId),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.detail(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useRequestTransferOrder = (
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminOrderResponse,
    FetchError,
    HttpTypes.AdminRequestOrderTransfer
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminRequestOrderTransfer) =>
      sdk.admin.order.requestTransfer(orderId, payload),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.changes(orderId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useTransferOrderToGuest = (
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminOrderResponse,
    FetchError,
    HttpTypes.AdminTransferOrderToGuest
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminTransferOrderToGuest) =>
      sdk.admin.order.transferToGuest(orderId, payload),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.changes(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.detail(orderId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useCancelOrderTransfer = (
  orderId: string,
  options?: UseMutationOptions<any, FetchError, void>
) => {
  return useMutation({
    mutationFn: () => sdk.admin.order.cancelTransfer(orderId),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.changes(orderId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useCreateOrderCreditLine = (
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminOrderResponse,
    FetchError,
    Omit<CreateOrderCreditLineDTO, "order_id">
  >
) => {
  return useMutation({
    mutationFn: (payload) => sdk.admin.order.createCreditLine(orderId, payload),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.details(),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useAuthorizePaymentSession = (
  orderId: string,
  sessionId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminAuthorizeOrderPaymentSessionResponse,
    FetchError,
    void
  >
) => {
  return useMutation({
    mutationFn: () =>
      sdk.admin.order.authorizePaymentSession(orderId, sessionId),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.detail(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateOrderChange = (
  orderChangeId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminOrderChangeResponse,
    FetchError,
    { carry_over_promotions?: boolean; internal_note?: string | null }
  >
) => {
  return useMutation({
    mutationFn: (payload: {
      carry_over_promotions?: boolean
      internal_note?: string | null
    }) => sdk.admin.order.updateOrderChange(orderChangeId, payload),
    onSuccess: (data, variables, context) => {
      const orderId = data.order_change.order_id

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.details(),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.changes(orderId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useExportOrders = (
  query?: HttpTypes.AdminOrderFilters,
  options?: UseMutationOptions<
    { transaction_id: string },
    FetchError,
    HttpTypes.AdminOrderFilters
  >
) => {
  return useMutation({
    mutationFn: () => sdk.admin.order.export(query),
    onSuccess: (data, variables, context) => {
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

/**
 * Carrier-rate quotes are keyed under their own root, deliberately NOT
 * nested under `ordersQueryKeys` (`["orders", ...]`): every order mutation
 * invalidates `ordersQueryKeys.all` by prefix, and a quote nested under it
 * would be re-fetched each time - a brand new EasyPost shipment with new
 * rate ids for every visible row, which resets each row's manually picked
 * rate back to the cheapest. A quote still re-fetches whenever its own
 * `location_id`/`parcel` change, since both are part of its key.
 */
export const carrierRatesQueryKeys = {
  all: ["carrier-rates"] as const,
  order: (orderId: string) => ["carrier-rates", orderId] as const,
  quote: (
    orderId: string,
    params: { location_id: string | null; parcel: PackageSelection }
  ) => ["carrier-rates", orderId, params] as const,
}

export type QuotedCarrierRate = {
  carrier: string
  service: string
  name: string
  rate_id: string
  amount: string
  currency: string
}

export type OrderCarrierRatesResponse = {
  shipment_id: string
  rates: QuotedCarrierRate[]
}

/**
 * The `POST /admin/orders/:id/carrier-rates` route's (Task 6) request body
 * shape uses a snake_case `parcel.predefined_package`, unlike
 * `PackageSelection`'s own camelCase `predefinedPackage` (the shape
 * `PackagePopover`'s `onChange` hands back, matching the rest of this
 * dashboard's convention) - mapped here, once, rather than at every call
 * site of this hook.
 */
const toCarrierRatesParcel = (parcel: PackageSelection) => ({
  weight: parcel.weight,
  length: parcel.length,
  width: parcel.width,
  height: parcel.height,
  predefined_package: parcel.predefinedPackage,
})

/**
 * Quotes every carrier rate EasyPost can offer for one order's parcel,
 * shipped from the given stock location - the Ready to Ship table's
 * Shipping Rate column (`shipping-rate-select.tsx`) re-quotes whenever
 * `location_id`/`parcel` differ from the last call, since both are part of
 * this query's own key. There's no SDK method for this new, non-core route
 * - `sdk.client.fetch` is called directly, the same low-level pattern
 * `FulfillmentQueuePage`
 * (`apps/backend/src/admin/routes/fulfillment-queue/page.tsx`) already
 * uses for its own non-core route.
 *
 * Unlike this file's other hooks (`useOrder`, `useOrderPreview`, ...), the
 * raw `useQuery` result is returned as-is - not flattened into
 * `{ ...data, ...rest }` - since `ShippingRateSelect` reads `data.rates`/
 * `data.shipment_id` directly, the same shape `FulfillmentQueuePage` itself
 * reads its own query's `data` with.
 */
export const useOrderCarrierRates = (
  orderId: string,
  params: { location_id: string | null; parcel: PackageSelection },
  options?: { enabled?: boolean }
) => {
  return useQuery({
    // No location means nothing to quote from - never send a request that
    // can only fail (`ShippingRateSelect` renders an actionable message for
    // this case instead).
    enabled: !!params.location_id && (options?.enabled ?? true),
    queryFn: async () =>
      sdk.client.fetch<OrderCarrierRatesResponse>(
        `/admin/orders/${orderId}/carrier-rates`,
        {
          method: "POST",
          body: {
            location_id: params.location_id,
            parcel: toCarrierRatesParcel(params.parcel),
          },
        }
      ),
    queryKey: carrierRatesQueryKeys.quote(orderId, params),
  })
}
