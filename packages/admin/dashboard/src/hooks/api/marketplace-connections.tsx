import { FetchError } from "@medusajs/js-sdk"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"
import { salesChannelsQueryKeys } from "./sales-channels"

const MARKETPLACE_CONNECTIONS_QUERY_KEY = "marketplace-connections" as const
export const marketplaceConnectionsQueryKeys = queryKeysFactory(
  MARKETPLACE_CONNECTIONS_QUERY_KEY
)

const BASE_PATH = "/admin/marketplace-connections"

export type MarketplaceKey = "shopify" | "woocommerce" | "amazon"

export type MarketplaceConnectionStatus =
  "connected" | "error" | "disconnected" | "unavailable"

export type MarketplaceConnection = {
  id: string
  marketplace: MarketplaceKey
  display_name: string | null
  status: string
  last_error: string | null
  last_synced_at: string | null
  linked_listings: number
  sales_channel_id: string | null
  managed: boolean
  read_only: boolean
  credentials_source: string
  sync_live: boolean
  fields: Record<string, unknown>
  webhook_url: string | null
  // Added by the backend in Task 14; absent means off.
  auto_sync_price?: boolean
}

export type MarketplaceTestResult = { ok: boolean; message?: string }

export type MarketplaceCredentialKey =
  | "shop_domain"
  | "access_token"
  | "webhook_secret"
  | "location_id"
  | "site_url"
  | "consumer_key"
  | "consumer_secret"
  | "seller_id"
  | "marketplace_id"
  | "refresh_token"

type CredentialFields = Partial<Record<MarketplaceCredentialKey, string>>

export type CreateMarketplaceSalesChannelInput = {
  marketplace: MarketplaceKey
  display_name?: string
} & CredentialFields &
  (
    | {
        // Creates a new sales channel with the connection.
        name: string
        description?: string
        is_disabled?: boolean
        sales_channel_id?: never
      }
    | {
        // Attaches the connection to an existing sales channel.
        sales_channel_id: string
        name?: never
        description?: never
        is_disabled?: never
      }
  )

export type CreateMarketplaceSalesChannelResponse = {
  sales_channel: { id: string; name: string }
  connection: MarketplaceConnection | null
  test: MarketplaceTestResult | null
  connection_status: MarketplaceConnectionStatus
  message?: string
  input_problem?: "missing" | "invalid"
  fields?: string[]
}

export type SaveMarketplaceConnectionInput = CredentialFields & {
  auto_sync_price?: boolean
}

export type MarketplaceConnectionResponse = {
  connection?: MarketplaceConnection | null
  test?: MarketplaceTestResult | null
  ok?: boolean
  message?: string
  [key: string]: unknown
}

const invalidateConnections = (salesChannelId?: string | null) => {
  queryClient.invalidateQueries({
    queryKey: marketplaceConnectionsQueryKeys.all,
  })
  queryClient.invalidateQueries({ queryKey: salesChannelsQueryKeys.lists() })
  queryClient.invalidateQueries({
    queryKey: salesChannelId
      ? salesChannelsQueryKeys.detail(salesChannelId)
      : salesChannelsQueryKeys.details(),
  })
}

export const useCreateMarketplaceSalesChannel = (
  options?: UseMutationOptions<
    CreateMarketplaceSalesChannelResponse,
    FetchError,
    CreateMarketplaceSalesChannelInput
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<CreateMarketplaceSalesChannelResponse>(BASE_PATH, {
        method: "POST",
        body: payload,
      }),
    ...options,
    onSuccess: (data, variables, context) => {
      invalidateConnections(data.sales_channel?.id)
      options?.onSuccess?.(data, variables, context)
    },
  })
}

// The connection of one sales channel, or null when it has none.
export const useMarketplaceConnection = (
  salesChannelId: string,
  options?: Omit<
    UseQueryOptions<
      { connections: MarketplaceConnection[] },
      FetchError,
      { connections: MarketplaceConnection[] },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: marketplaceConnectionsQueryKeys.list({
      sales_channel_id: salesChannelId,
    }),
    queryFn: () =>
      sdk.client.fetch<{ connections: MarketplaceConnection[] }>(BASE_PATH, {
        query: { sales_channel_id: salesChannelId },
      }),
    ...options,
  })

  return { connection: data?.connections?.[0] ?? null, ...rest }
}

export const useSaveMarketplaceConnection = (
  id: string,
  options?: UseMutationOptions<
    MarketplaceConnectionResponse,
    FetchError,
    SaveMarketplaceConnectionInput
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<MarketplaceConnectionResponse>(`${BASE_PATH}/${id}`, {
        method: "POST",
        body: payload,
      }),
    ...options,
    onSuccess: (data, variables, context) => {
      invalidateConnections(data?.connection?.sales_channel_id)
      options?.onSuccess?.(data, variables, context)
    },
  })
}

export const useTestMarketplaceConnection = (
  id: string,
  options?: UseMutationOptions<MarketplaceConnectionResponse, FetchError, void>
) => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<MarketplaceConnectionResponse>(
        `${BASE_PATH}/${id}/test`,
        { method: "POST" }
      ),
    ...options,
    onSuccess: (data, variables, context) => {
      invalidateConnections(data?.connection?.sales_channel_id)
      options?.onSuccess?.(data, variables, context)
    },
  })
}

export const useLinkMarketplaceConnection = (
  id: string,
  options?: UseMutationOptions<MarketplaceConnectionResponse, FetchError, void>
) => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<MarketplaceConnectionResponse>(
        `${BASE_PATH}/${id}/link`,
        { method: "POST" }
      ),
    ...options,
    onSuccess: (data, variables, context) => {
      invalidateConnections(data?.connection?.sales_channel_id)
      options?.onSuccess?.(data, variables, context)
    },
  })
}

// Channel product import (Phase 4a). Shapes pass through unchanged from
// seller-hub; detail lists are capped there, the *_total fields are not.
export type ImportPreviewListing = {
  sku: string
  title: string
  // The channel's own price string, e.g. "19.99".
  price: string
  stock: number | null
  image_url: string | null
}

export type ImportPreview = {
  matched: { sku: string; title: string }[]
  unmatched: ImportPreviewListing[]
  duplicates: string[]
  no_sku: ImportPreviewListing[]
  matched_total: number
  unmatched_total: number
  duplicates_total: number
  no_sku_total: number
}

export type ImportOutcome = {
  imported: string[]
  failed: { sku: string; message: string }[]
  failed_total: number
  skipped_counts: { already_linked: number; matched: number; currency: number }
  skipped: { sku: string; reason: string }[]
  skipped_total: number
  deferred: string[]
  deferred_total: number
}

export type RunImportInput = { skus: "all" | string[] }

export const importPreviewQueryKey = (connectionId: string) =>
  [
    ...marketplaceConnectionsQueryKeys.detail(connectionId),
    "import-preview",
  ] as const

export const useImportPreview = (
  connectionId: string,
  options?: Omit<
    UseQueryOptions<ImportPreview, FetchError, ImportPreview, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  return useQuery({
    queryKey: importPreviewQueryKey(connectionId),
    queryFn: () =>
      sdk.client.fetch<ImportPreview>(
        `${BASE_PATH}/${connectionId}/import-preview`,
        { method: "GET" }
      ),
    ...options,
  })
}

export const useRunImport = (
  connectionId: string,
  options?: UseMutationOptions<ImportOutcome, FetchError, RunImportInput>
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<ImportOutcome>(`${BASE_PATH}/${connectionId}/import`, {
        method: "POST",
        body: payload,
      }),
    ...options,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: importPreviewQueryKey(connectionId),
      })
      // Imports link listings, so the connection's counts change too.
      invalidateConnections()
      options?.onSuccess?.(data, variables, context)
    },
  })
}

export const useDisconnectMarketplaceConnection = (
  id: string,
  options?: UseMutationOptions<MarketplaceConnectionResponse, FetchError, void>
) => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<MarketplaceConnectionResponse>(`${BASE_PATH}/${id}`, {
        method: "DELETE",
      }),
    ...options,
    onSuccess: (data, variables, context) => {
      invalidateConnections()
      options?.onSuccess?.(data, variables, context)
    },
  })
}
