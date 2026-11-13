export type Marketplace = "shopify" | "woocommerce" | "amazon"

export type ConnectionStatus = "connected" | "disconnected" | "error"

export type Connection = {
  marketplace: Marketplace
  status: ConnectionStatus
  last_error: string | null
  last_synced_at: string | null
  linked_listings: number
  sales_channel_id: string | null
  credentials_source: "database" | "environment" | "none"
  read_only: boolean
  // Non-secret values only (shop_domain, location_id, site_url, ...).
  fields: Record<string, unknown>
  webhook_url: string
}

export type ConnectionsResponse = { connections: Connection[] }

export type SaveResponse = {
  ok: boolean
  error?: string
  connection: Connection
}

export type TestResponse = { ok: boolean; detail?: string; message?: string }

export type LinkResponse = {
  linked: number
  already_linked: number
  unmatched: number
  duplicates: number
}

export type DisconnectResponse = { ok: boolean; env_fallback: boolean }

export type SalesChannelOption = { id: string; name: string }

export type FieldDef = {
  key: string
  label: string
  secret: boolean
}
