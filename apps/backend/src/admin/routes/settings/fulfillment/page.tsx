import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Input, Label, Select, Text } from "@medusajs/ui"
import { sdk } from "../../../lib/sdk"

type Metadata = Record<string, unknown> | null

type StockLocation = {
  id: string
  name: string
}

type SalesChannel = {
  id: string
  name: string
  metadata: Metadata
}

const FulfillmentSettingsPage = () => {
  const { data: storeData, refetch: refetchStore } = useQuery({
    queryKey: ["admin", "settings", "fulfillment", "store"],
    queryFn: () => sdk.admin.store.list(),
  })

  const { data: locationsData } = useQuery({
    queryKey: ["admin", "settings", "fulfillment", "stock-locations"],
    queryFn: () => sdk.admin.stockLocation.list(),
  })

  const { data: channelsData, refetch: refetchChannels } = useQuery({
    queryKey: ["admin", "settings", "fulfillment", "sales-channels"],
    queryFn: () => sdk.admin.salesChannel.list(),
  })

  const store = storeData?.stores?.[0]
  const locations = (locationsData?.stock_locations ?? []) as StockLocation[]
  const channels = (channelsData?.sales_channels ?? []) as SalesChannel[]

  const selectedLocationId = (store?.metadata?.default_ship_from_location_id as
    | string
    | undefined) ?? undefined
  const selectedLocation = locations.find(
    (location) => location.id === selectedLocationId
  )

  const handleLocationChange = async (locationId: string) => {
    if (!store) {
      return
    }

    await sdk.admin.store.update(store.id, {
      metadata: { ...store.metadata, default_ship_from_location_id: locationId },
    })
    refetchStore()
  }

  const handleHandlingHoursBlur = async (
    channel: SalesChannel,
    rawValue: string
  ) => {
    // A cleared input means "no SLA for this channel": the key is removed
    // rather than saved as `Number("") === 0`, which would make every order
    // on the channel instantly Overdue with no way to unset it. (The sales
    // channel module replaces `metadata` wholesale on update, so omitting
    // the key removes it.)
    if (rawValue.trim() === "") {
      if (channel.metadata?.handling_hours === undefined) {
        return
      }

      const { handling_hours: _removed, ...rest } = channel.metadata ?? {}
      await sdk.admin.salesChannel.update(channel.id, { metadata: rest })
      refetchChannels()
      return
    }

    const handlingHours = Number(rawValue)

    if (Number.isNaN(handlingHours)) {
      return
    }

    await sdk.admin.salesChannel.update(channel.id, {
      metadata: { ...channel.metadata, handling_hours: handlingHours },
    })
    refetchChannels()
  }

  const [thresholdError, setThresholdError] = useState<string | null>(null)

  const highValueThreshold = store?.metadata?.high_value_threshold as
    | number
    | string
    | undefined

  const handleHighValueThresholdBlur = async (rawValue: string) => {
    if (!store) {
      return
    }

    // A cleared input must send an empty string: Medusa merges store
    // metadata and only deletes a key whose value is "". Consumers treat ""
    // as "use the default (500)".
    if (rawValue.trim() === "") {
      setThresholdError(null)

      const current = store.metadata?.high_value_threshold

      if (current === undefined || current === null || current === "") {
        return
      }

      await sdk.admin.store.update(store.id, {
        metadata: { ...store.metadata, high_value_threshold: "" },
      })
      refetchStore()
      return
    }

    const threshold = Number(rawValue)

    if (!Number.isFinite(threshold) || threshold <= 0) {
      setThresholdError("Enter a number greater than zero.")
      return
    }

    setThresholdError(null)

    // Unchanged value: skip the write.
    if (
      highValueThreshold !== undefined &&
      highValueThreshold !== "" &&
      Number(highValueThreshold) === threshold
    ) {
      return
    }

    await sdk.admin.store.update(store.id, {
      metadata: { ...store.metadata, high_value_threshold: threshold },
    })
    refetchStore()
  }

  return (
    <Container>
      <Heading level="h1">Fulfillment</Heading>

      <div>
        <Heading level="h2">Default ship-from location</Heading>
        <Text size="small">
          Orders are shipped from this location unless overridden on the order.
        </Text>

        {store && (
          <Select value={selectedLocationId} onValueChange={handleLocationChange}>
            <Select.Trigger>
              <Select.Value placeholder="Select a location">
                {selectedLocation?.name}
              </Select.Value>
            </Select.Trigger>
            <Select.Content>
              {locations.map((location) => (
                <Select.Item key={location.id} value={location.id}>
                  {location.name}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        )}
      </div>

      <div>
        <Heading level="h2">High-value order alerts</Heading>
        <Text size="small">
          Orders above this total are flagged as high value. Leave blank
          to use the default of 500.
        </Text>

        {store && (
          <div>
            <Label htmlFor="high-value-threshold">
              High-value order alert threshold
            </Label>
            <Input
              id="high-value-threshold"
              type="number"
              min={0.01}
              step="any"
              key={String(highValueThreshold ?? "")}
              defaultValue={highValueThreshold ?? ""}
              aria-invalid={thresholdError ? true : undefined}
              onBlur={(event) =>
                handleHighValueThresholdBlur(event.target.value)
              }
            />
            {thresholdError && (
              <Text size="small" className="text-ui-fg-error" role="alert">
                {thresholdError}
              </Text>
            )}
          </div>
        )}
      </div>

      <div>
        <Heading level="h2">Sales channel handling time</Heading>
        <Text size="small">
          Hours allowed to pack an order placed through each channel before it
          counts as late.
        </Text>

        {channels.map((channel) => {
          const inputId = `handling-hours-${channel.id}`
          const handlingHours = channel.metadata?.handling_hours as
            | number
            | undefined

          return (
            <div key={channel.id}>
              <Label htmlFor={inputId}>{channel.name}</Label>
              <Input
                id={inputId}
                type="number"
                min={0}
                defaultValue={handlingHours ?? ""}
                onBlur={(event) =>
                  handleHandlingHoursBlur(channel, event.target.value)
                }
              />
            </div>
          )
        })}
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Fulfillment",
})

export default FulfillmentSettingsPage
