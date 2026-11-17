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

export const CHANNEL_OFFERS_POLL_MS = 10_000

/**
 * Seller Hub reports sync results back asynchronously, so a marketplace cell
 * that is still pending has to be re-read. Only cells of a connected channel
 * count: other channels' offers default to "pending" and nothing flips them.
 */
export const hasPendingConnectedCell = (
  data: ChannelOffersResponse | undefined
): boolean =>
  !!data?.rows.some((row) =>
    Object.values(row.channels).some(
      (cell) => cell.has_connection && cell.sync_state === "pending"
    )
  )

export const useChannelOffers = (params: ChannelOffersParams) =>
  useQuery<ChannelOffersResponse, FetchError>({
    queryKey: channelOffersQueryKeys.list(params),
    refetchInterval: (query) => {
      if (hasPendingConnectedCell(query.state.data)) {
        return CHANNEL_OFFERS_POLL_MS
      }
      return false
    },
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

export type UpdateChannelOfferBody = {
  /** A number sets the channel price, null clears it (falls back to base). */
  price?: number | null
  stock?: number
}

export type UpdateChannelOfferVariables = {
  variant_id: string
  channel_id: string
  body: UpdateChannelOfferBody
}

export type UpdateChannelOfferResponse = {
  variant_id: string
  sales_channel_id: string
  kind: "stock" | "price" | "both" | null
}

export const useUpdateChannelOffer = (
  options?: UseMutationOptions<
    UpdateChannelOfferResponse,
    FetchError,
    UpdateChannelOfferVariables
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ variant_id, channel_id, body }) =>
      sdk.client.fetch<UpdateChannelOfferResponse>(
        `/admin/channel-offers/${variant_id}/${channel_id}`,
        { method: "POST", body }
      ),
    ...options,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: channelOffersQueryKeys.all })
      options?.onSuccess?.(data, variables, context)
    },
  })
}

export type SyncChannelOfferVariables = {
  variant_id: string
  channel_id: string
}

export const useSyncChannelOffer = (
  options?: UseMutationOptions<
    { queued: boolean },
    FetchError,
    SyncChannelOfferVariables
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ variant_id, channel_id }) =>
      sdk.client.fetch<{ queued: boolean }>(
        `/admin/channel-offers/${variant_id}/${channel_id}/sync`,
        { method: "POST" }
      ),
    ...options,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: channelOffersQueryKeys.all })
      options?.onSuccess?.(data, variables, context)
    },
  })
}

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
