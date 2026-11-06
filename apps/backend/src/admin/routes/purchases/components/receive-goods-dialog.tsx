import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button, Drawer, Input, Label, Text, toast } from "@medusajs/ui"
import { sdk } from "../../../lib/sdk"
import { errorMessage } from "../format"
import type { AdminPurchase } from "../types"

type StockLocation = { id: string; name: string }

// Returns an error message for an invalid quantity, or null when it is fine.
// An empty field counts as 0.
function quantityError(raw: string | undefined, remaining: number) {
  if (!raw) {
    return null
  }
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) {
    return "Enter a whole number."
  }
  if (value > remaining) {
    return `Cannot receive more than ${remaining}.`
  }
  return null
}

export function ReceiveGoodsDialog({
  purchase,
  onReceived,
}: {
  purchase: AdminPurchase
  onReceived?: () => void
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [locationId, setLocationId] = useState("")
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)

  const {
    data: locationsData,
    isLoading: locationsLoading,
    isError: locationsError,
    refetch: refetchLocations,
  } = useQuery({
    queryKey: ["admin", "stock-locations", "receive-goods"],
    queryFn: () => sdk.admin.stockLocation.list({ fields: "id,name", limit: 100 }),
    enabled: open,
  })
  const locations = (locationsData?.stock_locations ?? []) as StockLocation[]

  const lines = purchase.items
    .map((item) => ({
      item,
      error: quantityError(quantities[item.id], item.remaining),
      quantity: Number(quantities[item.id] || 0),
    }))
  const hasError = lines.some((line) => line.error)
  const toReceive = lines.filter((line) => !line.error && line.quantity > 0)
  const canSubmit = !!locationId && !hasError && toReceive.length > 0

  const receive = useMutation({
    mutationFn: () =>
      sdk.client.fetch(`/admin/purchases/${purchase.id}/receive`, {
        method: "POST",
        body: {
          stock_location_id: locationId,
          items: toReceive.map((line) => ({
            purchase_item_id: line.item.id,
            quantity: line.quantity,
          })),
        },
      }),
    onMutate: () => setSubmitError(null),
    onSuccess: () => {
      toast.success("Goods received")
      setOpen(false)
      queryClient.invalidateQueries({ queryKey: ["admin", "purchases"] })
      onReceived?.()
    },
    onError: (error: unknown) => {
      setSubmitError(errorMessage(error, "Failed to receive the goods."))
    },
  })

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setLocationId("")
      setQuantities({})
      setSubmitError(null)
    }
  }

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <Drawer.Trigger asChild>
        <Button size="small">Receive goods</Button>
      </Drawer.Trigger>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Receive goods</Drawer.Title>
          <Drawer.Description className="sr-only">
            Record a delivery for {purchase.reference}
          </Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-4 overflow-y-auto">
          <div className="flex flex-col gap-1">
            <Label htmlFor="receive-stock-location">Stock location</Label>
            {locationsLoading && <Text size="small">Loading locations...</Text>}
            {locationsError && (
              <div className="flex items-center gap-2">
                <Text size="small" className="text-ui-fg-error">
                  Could not load stock locations.
                </Text>
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() => refetchLocations()}
                >
                  Retry
                </Button>
              </div>
            )}
            {!locationsLoading && !locationsError && locations.length === 0 && (
              <Text size="small" className="text-ui-fg-subtle">
                No stock locations found. Create one in Settings first.
              </Text>
            )}
            {!locationsLoading && !locationsError && locations.length > 0 && (
              <select
                id="receive-stock-location"
                className="bg-ui-bg-field text-ui-fg-base shadow-borders-base txt-compact-small rounded-md px-2 py-1.5"
                value={locationId}
                onChange={(event) => setLocationId(event.target.value)}
              >
                <option value="">Select a location</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {lines.map(({ item, error }) => (
            <div key={item.id} className="flex items-start justify-between gap-4">
              <div className="flex flex-col">
                <Text size="small" weight="plus">
                  {item.title}
                </Text>
                <Text size="small" className="text-ui-fg-subtle">
                  {item.sku}
                </Text>
                <Text size="small" className="text-ui-fg-subtle">
                  Remaining: {item.remaining}
                </Text>
              </div>
              <div className="flex w-28 flex-col gap-1">
                <Input
                  type="number"
                  size="small"
                  min={0}
                  max={item.remaining}
                  step={1}
                  aria-label={`Quantity for ${item.title}`}
                  disabled={item.remaining === 0}
                  value={quantities[item.id] ?? ""}
                  onChange={(event) =>
                    setQuantities((current) => ({
                      ...current,
                      [item.id]: event.target.value,
                    }))
                  }
                />
                {error && (
                  <Text size="small" className="text-ui-fg-error">
                    {error}
                  </Text>
                )}
              </div>
            </div>
          ))}

          {submitError && (
            <Text size="small" className="text-ui-fg-error">
              {submitError}
            </Text>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button size="small" variant="secondary">
              Cancel
            </Button>
          </Drawer.Close>
          <Button
            size="small"
            isLoading={receive.isPending}
            disabled={!canSubmit || receive.isPending}
            onClick={() => receive.mutate()}
          >
            Receive
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}
