import { FetchError } from "@medusajs/js-sdk"
import {
  useMutation,
  UseMutationOptions,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { sdk } from "../../lib/client"

const CHANNEL_OFFERS_QUERY_KEY = "channel-offers" as const

export type ChannelKind = "marketplace" | "web" | "pos" | "other"

export type ChannelOfferCell = {
  price: number | null
  effective_price: number | null
  stock: number
  sync_state: string | null
  last_synced_at: string | null
  last_error: string | null
  has_connection: boolean
}

export type ChannelOfferRow = {
  variant_id: string
  product_id: string
  product_title: string
  variant_title: string | null
  sku: string | null
  base_price: number | null
  available: number
  unallocated: number
  channels: Record<string, ChannelOfferCell>
}

export type ChannelOfferChannel = {
  id: string
  name: string
  kind: ChannelKind
  has_connection: boolean
}

export type ChannelOffersResponse = {
  rows: ChannelOfferRow[]
  channels: ChannelOfferChannel[]
  count: number
  truncated: boolean
}

export type ChannelOffersParams = {
  q?: string
  order?: string
  limit?: number
  offset?: number
  channel_ids?: string[]
}

export const channelOffersQueryKeys = {
  all: [CHANNEL_OFFERS_QUERY_KEY] as const,
  list: (params?: ChannelOffersParams) =>
    [CHANNEL_OFFERS_QUERY_KEY, "list", { params }] as const,
  settings: () => [CHANNEL_OFFERS_QUERY_KEY, "settings"] as const,
}

const toQuery = (params: ChannelOffersParams) => {
  const query: Record<string, string | number> = {}
  if (params.q) {
    query.q = params.q
  }
  if (params.order) {
    query.order = params.order
  }
  if (params.limit !== undefined) {
    query.limit = params.limit
  }
  if (params.offset !== undefined) {
    query.offset = params.offset
  }
  if (params.channel_ids?.length) {
    query.channel_ids = params.channel_ids.join(",")
  }
  return query
}

export const useChannelOffers = (params: ChannelOffersParams) =>
  useQuery<ChannelOffersResponse, FetchError>({
    queryKey: channelOffersQueryKeys.list(params),
    queryFn: () =>
      sdk.client.fetch<ChannelOffersResponse>("/admin/channel-offers", {
        query: toQuery(params),
      }),
    placeholderData: (previous) => previous,
  })

export type ChannelStockSettings = { share_stock_after_sale: boolean }

export const useChannelStockSettings = () =>
  useQuery<ChannelStockSettings, FetchError>({
    queryKey: channelOffersQueryKeys.settings(),
    queryFn: () =>
      sdk.client.fetch<ChannelStockSettings>("/admin/channel-stock-settings"),
  })

export const useUpdateChannelStockSettings = (
  options?: UseMutationOptions<
    ChannelStockSettings,
    FetchError,
    ChannelStockSettings
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body) =>
      sdk.client.fetch<ChannelStockSettings>("/admin/channel-stock-settings", {
        method: "POST",
        body,
      }),
    ...options,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: channelOffersQueryKeys.settings(),
      })
      options?.onSuccess?.(data, variables, context)
    },
  })
}
