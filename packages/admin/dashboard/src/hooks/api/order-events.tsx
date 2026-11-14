import { FetchError } from "@medusajs/js-sdk"
import { useQuery } from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const ORDER_EVENTS_QUERY_KEY = "order-events" as const
export const orderEventsQueryKeys = queryKeysFactory(ORDER_EVENTS_QUERY_KEY)

export type OrderEvent = {
  id: string
  type: string
  /** "system", or the acting admin user (`id: "unknown"` when not known). */
  actor: "system" | { id: string; name: string | null }
  old_value: unknown
  new_value: unknown
  created_at: string
}

const EMPTY_EVENTS: OrderEvent[] = []

type OrderEventsResponse = { events: OrderEvent[] }

export const useOrderEvents = (orderId: string | undefined) => {
  const { data, isLoading, isError } = useQuery<
    OrderEventsResponse,
    FetchError
  >({
    queryKey: orderEventsQueryKeys.detail(orderId ?? ""),
    queryFn: () =>
      sdk.client.fetch<OrderEventsResponse>(`/admin/orders/${orderId}/events`),
    enabled: !!orderId,
  })

  return { events: data?.events ?? EMPTY_EVENTS, isLoading, isError }
}
