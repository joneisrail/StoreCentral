import { useEffect, useState } from "react"
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Badge, Button, Container, Heading, Input, Text } from "@medusajs/ui"
import { sdk } from "../../lib/sdk"
import type {
  Connection,
  ConnectionsResponse,
  DisconnectResponse,
  FieldDef,
  LinkResponse,
  Marketplace,
  SalesChannelOption,
  SaveResponse,
  TestResponse,
} from "./types"

const KEY = ["admin", "marketplace-connections"] as const
const BASE = "/admin/marketplace-connections"

const TITLES: Record<Marketplace, string> = {
  shopify: "Shopify",
  woocommerce: "WordPress",
  amazon: "Amazon",
}

const FIELDS: Record<"shopify" | "woocommerce", FieldDef[]> = {
  shopify: [
    { key: "shop_domain", label: "Store domain", secret: false },
    { key: "access_token", label: "Access token", secret: true },
    { key: "webhook_secret", label: "Webhook secret", secret: true },
    { key: "location_id", label: "Location ID", secret: false },
  ],
  woocommerce: [
    { key: "site_url", label: "Site URL", secret: false },
    { key: "consumer_key", label: "Consumer key", secret: true },
    { key: "consumer_secret", label: "Consumer secret", secret: true },
    { key: "webhook_secret", label: "Webhook secret", secret: true },
  ],
}

const ORDER: Marketplace[] = ["shopify", "woocommerce", "amazon"]

const emptyConnection = (marketplace: Marketplace): Connection => ({
  marketplace,
  status: "disconnected",
  last_error: null,
  last_synced_at: null,
  linked_listings: 0,
  sales_channel_id: null,
  credentials_source: "none",
  read_only: marketplace === "amazon",
  fields: {},
  webhook_url: "",
})

type HttpError = Error & { status?: number }

const isUnavailable = (err: unknown) => {
  const status = (err as HttpError)?.status
  return status === 502 || status === 503
}

const errorMessage = (err: unknown, fallback: string) => {
  const status = (err as HttpError)?.status
  if (status === 409) {
    return "The connector is not running. Save the connection first."
  }
  if (status === 400) {
    return "Some fields are invalid. Check the values and try again."
  }
  return err instanceof Error && err.message ? err.message : fallback
}

const badgeColor = (status: string) =>
  status === "connected" ? "green" : status === "error" ? "red" : "grey"

const textValue = (fields: Record<string, unknown>, key: string) => {
  const value = fields[key]
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : ""
}

type CardProps = {
  connection: Connection
  channels: SalesChannelOption[]
  onUnavailable: (message: string | null) => void
}

const ConnectionCard = ({ connection, channels, onUnavailable }: CardProps) => {
  const queryClient = useQueryClient()
  const { marketplace } = connection
  const writable = !connection.read_only && marketplace !== "amazon"
  const defs = writable ? FIELDS[marketplace as "shopify" | "woocommerce"] : []

  const [values, setValues] = useState<Record<string, string>>({})
  const [channel, setChannel] = useState(connection.sales_channel_id ?? "")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  // Non-secret fields come from the server; secrets are never read from it.
  const serverFields = defs
    .filter((d) => !d.secret)
    .map((d) => textValue(connection.fields, d.key))
    .join("\u0000")
  useEffect(() => {
    setValues((prev) => {
      const next = { ...prev }
      for (const d of defs) {
        if (!d.secret) {
          next[d.key] = textValue(connection.fields, d.key)
        }
      }
      return next
    })
  }, [serverFields])

  useEffect(() => {
    setChannel(connection.sales_channel_id ?? "")
  }, [connection.sales_channel_id])

  const clear = () => {
    setError(null)
    setNotice(null)
    setWarning(null)
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY })

  const handleError = (err: unknown, fallback: string) => {
    if (isUnavailable(err)) {
      onUnavailable((err as Error).message)
      return
    }
    setError(errorMessage(err, fallback))
  }

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, string> = {}
      for (const d of defs) {
        const value = (values[d.key] ?? "").trim()
        if (value) {
          body[d.key] = value
        }
      }
      if (channel) {
        body.sales_channel_id = channel
      }
      return sdk.client.fetch<SaveResponse>(`${BASE}/${marketplace}`, {
        method: "POST",
        body,
      })
    },
    onMutate: clear,
    onSuccess: (data) => {
      onUnavailable(null)
      setValues((prev) => {
        const next = { ...prev }
        for (const d of defs) {
          if (d.secret) {
            next[d.key] = ""
          }
        }
        return next
      })
      if (data.ok) {
        setNotice("Saved and connected.")
      } else {
        setError(data.error ?? "Saved, but the connector could not start.")
      }
      refresh()
    },
    onError: (err) => handleError(err, "Could not save the connection."),
  })

  const test = useMutation({
    mutationFn: () =>
      sdk.client.fetch<TestResponse>(`${BASE}/${marketplace}/test`, {
        method: "POST",
      }),
    onMutate: clear,
    onSuccess: (data) => {
      onUnavailable(null)
      if (data.ok) {
        setNotice(data.detail ?? "Connection works.")
      } else {
        setError(data.message ?? "The connection test failed.")
      }
      refresh()
    },
    onError: (err) => handleError(err, "Could not test the connection."),
  })

  const link = useMutation({
    mutationFn: () =>
      sdk.client.fetch<LinkResponse>(`${BASE}/${marketplace}/link`, {
        method: "POST",
      }),
    onMutate: clear,
    onSuccess: (data) => {
      onUnavailable(null)
      setNotice(
        `${data.linked} linked, ${data.already_linked} already linked, ` +
          `${data.unmatched} unmatched, ${data.duplicates} duplicates`
      )
      refresh()
    },
    onError: (err) => handleError(err, "Could not link products."),
  })

  const disconnect = useMutation({
    mutationFn: () =>
      sdk.client.fetch<DisconnectResponse>(`${BASE}/${marketplace}`, {
        method: "DELETE",
      }),
    onMutate: () => {
      clear()
      setConfirming(false)
    },
    onSuccess: (data) => {
      onUnavailable(null)
      setNotice("Disconnected.")
      if (data.env_fallback) {
        setWarning(
          "Environment variables will reconnect this marketplace when the server restarts."
        )
      }
      refresh()
    },
    onError: (err) => handleError(err, "Could not disconnect."),
  })

  const busy =
    save.isPending || test.isPending || link.isPending || disconnect.isPending
  const stored = connection.credentials_source !== "none"

  return (
    <Container data-testid={`connection-${marketplace}`}>
      <div className="flex items-center justify-between">
        <Heading level="h2">{TITLES[marketplace]}</Heading>
        <Badge color={badgeColor(connection.status)}>{connection.status}</Badge>
      </div>

      {!writable && (
        <Text size="small" className="text-ui-fg-subtle pt-2">
          Managed through environment configuration. Status only.
        </Text>
      )}

      {writable && (
        <>
          <div className="grid grid-cols-1 gap-3 py-4 md:grid-cols-2">
            {defs.map((d) => {
              const id = `${marketplace}-${d.key}`
              return (
                <div key={d.key} className="flex flex-col gap-1">
                  <label htmlFor={id} className="text-ui-fg-subtle txt-small">
                    {d.label}
                  </label>
                  <Input
                    id={id}
                    type={d.secret ? "password" : "text"}
                    autoComplete="off"
                    value={values[d.key] ?? ""}
                    onChange={(event) =>
                      setValues((prev) => ({
                        ...prev,
                        [d.key]: event.target.value,
                      }))
                    }
                  />
                  {d.secret && stored && (
                    <Text size="small" className="text-ui-fg-muted">
                      Stored
                    </Text>
                  )}
                </div>
              )
            })}
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`${marketplace}-channel`}
                className="text-ui-fg-subtle txt-small"
              >
                Sales channel
              </label>
              <select
                id={`${marketplace}-channel`}
                className="bg-ui-bg-field text-ui-fg-base border-ui-border-base rounded-md border px-2 py-1.5"
                value={channel}
                onChange={(event) => setChannel(event.target.value)}
              >
                <option value="">No sales channel</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </>
      )}

      <div className="flex flex-col gap-1 py-2">
        {writable && (
          <>
            <Text size="small">
              {`Last sync: ${
                connection.last_synced_at
                  ? new Date(connection.last_synced_at).toLocaleString()
                  : "never"
              }`}
            </Text>
            <Text size="small">{`Linked listings: ${connection.linked_listings}`}</Text>
          </>
        )}
        {connection.last_error && (
          <Text size="small" className="text-ui-fg-error">
            {`Latest error: ${connection.last_error}`}
          </Text>
        )}
        {writable && connection.webhook_url && (
          <div>
            <Text size="small" className="text-ui-fg-subtle">
              Webhook URL
            </Text>
            <Text size="small" className="break-all">
              {connection.webhook_url}
            </Text>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="pb-2">
          <Text size="small" className="text-ui-fg-error">
            {error}
          </Text>
        </div>
      )}
      {notice && (
        <Text size="small" className="text-ui-fg-subtle pb-2">
          {notice}
        </Text>
      )}
      {warning && (
        <div role="status" className="pb-2">
          <Text size="small" className="text-ui-fg-error">
            {warning}
          </Text>
        </div>
      )}

      {writable && (
        <div className="flex flex-wrap gap-2 pt-2">
          <Button size="small" disabled={busy} onClick={() => save.mutate()}>
            Save and connect
          </Button>
          <Button
            size="small"
            variant="secondary"
            disabled={busy}
            onClick={() => test.mutate()}
          >
            Test
          </Button>
          <Button
            size="small"
            variant="secondary"
            disabled={busy}
            onClick={() => link.mutate()}
          >
            Link products by SKU
          </Button>
          {confirming ? (
            <>
              <Button
                size="small"
                variant="danger"
                disabled={busy}
                onClick={() => disconnect.mutate()}
              >
                Confirm disconnect
              </Button>
              <Button
                size="small"
                variant="secondary"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="small"
              variant="secondary"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              Disconnect
            </Button>
          )}
        </div>
      )}
    </Container>
  )
}

const MarketplaceConnectionsPage = () => {
  const [actionUnavailable, setActionUnavailable] = useState<string | null>(
    null
  )

  const connectionsQuery = useQuery({
    queryKey: [...KEY, "list"],
    queryFn: () => sdk.client.fetch<ConnectionsResponse>(BASE),
  })

  const channelsQuery = useQuery({
    queryKey: [...KEY, "sales-channels"],
    queryFn: () => sdk.admin.salesChannel.list(),
  })

  const channels = (channelsQuery.data?.sales_channels ??
    []) as SalesChannelOption[]

  const listError = connectionsQuery.isError ? connectionsQuery.error : null
  const listUnavailable = listError && isUnavailable(listError)
  const bannerMessage = listUnavailable
    ? (listError as Error).message
    : actionUnavailable
  const hardError = !!listError && !listUnavailable

  const byMarketplace = new Map(
    (connectionsQuery.data?.connections ?? []).map((c) => [c.marketplace, c])
  )

  return (
    <div className="flex flex-col gap-4">
      <Container>
        <Heading level="h1">Marketplace connections</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Connect Shopify and WordPress, then link products by SKU.
        </Text>
      </Container>

      {bannerMessage && (
        <Container data-testid="unavailable-banner">
          <div role="alert" className="flex items-center justify-between gap-3">
            <Text className="text-ui-fg-error">{bannerMessage}</Text>
            <Button
              size="small"
              variant="secondary"
              onClick={() => {
                setActionUnavailable(null)
                connectionsQuery.refetch()
              }}
            >
              Retry
            </Button>
          </div>
        </Container>
      )}

      {connectionsQuery.isPending && (
        <Container>
          <Text>Loading...</Text>
        </Container>
      )}

      {hardError && (
        <Container>
          <Text>Something went wrong loading marketplace connections.</Text>
          <Button
            size="small"
            variant="secondary"
            onClick={() => connectionsQuery.refetch()}
          >
            Retry
          </Button>
        </Container>
      )}

      {!connectionsQuery.isPending &&
        !hardError &&
        ORDER.map((marketplace) => (
          <ConnectionCard
            key={marketplace}
            connection={
              byMarketplace.get(marketplace) ?? emptyConnection(marketplace)
            }
            channels={channels}
            onUnavailable={setActionUnavailable}
          />
        ))}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Marketplace connections",
})

export default MarketplaceConnectionsPage
