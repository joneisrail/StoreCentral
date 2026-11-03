import { Button, Select, Text } from "@medusajs/ui"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  OrderCarrierRatesResponse,
  useOrderCarrierRates,
} from "../../../../../../hooks/api/orders"
import { PackageSelection } from "./ready-to-ship-table"

type ShippingRateSelectProps = {
  orderId: string
  // Resolved by `resolveShipFromLocationId`; `null` when nothing resolves.
  locationId: string | null
  parcel: PackageSelection
  onChange: (rate: { shipmentId: string; rateId: string }) => void
}

const formatRateLabel = (rate: OrderCarrierRatesResponse["rates"][number]) =>
  `${rate.name} — ${rate.amount} ${rate.currency}`

/**
 * The Ready to Ship table's Shipping Rate column: a live, per-row EasyPost
 * quote (`useOrderCarrierRates`, keyed off `locationId`/`parcel` - a
 * changed Ship From or Package naturally re-quotes via that query key) with
 * every returned rate in the dropdown. The cheapest rate (already sorted
 * first by the backend) is auto-selected once a quote resolves.
 *
 * `autoSelectedDataRef` guards that auto-select against re-firing on a
 * render that doesn't carry new quote data: `useQuery` returns the exact
 * same `data` object reference across re-renders of the same cached query
 * result (e.g. the re-render this component's own `setSelectedRateId` below
 * causes when the admin manually picks a different rate), so comparing
 * `data` by reference - not deep-equality, not a one-shot "has this ever
 * run" boolean - is what tells "a genuinely new quote arrived" apart from
 * "this component re-rendered for an unrelated reason." Only a real
 * re-quote (a new `data` object, because the query key itself changed)
 * clears that guard and re-selects the new cheapest rate - and so does
 * `data` going away (a new key still loading, or failing), so that switching
 * back to an earlier, still-cached key re-selects its rate too.
 */
export const ShippingRateSelect = ({
  orderId,
  locationId,
  parcel,
  onChange,
}: ShippingRateSelectProps) => {
  const { t } = useTranslation()
  const { data, isError, refetch } = useOrderCarrierRates(orderId, {
    location_id: locationId,
    parcel,
  })

  const [selectedRateId, setSelectedRateId] = useState<string | null>(null)
  const autoSelectedDataRef = useRef<OrderCarrierRatesResponse | undefined>(
    undefined
  )

  useEffect(() => {
    if (!data) {
      // The current key is loading or failed. Forget which quote was last
      // auto-selected: the parent cleared this row's rate when its Ship
      // From/Package changed, so if the admin now switches BACK to a
      // previous selection, React Query hands back that selection's cached
      // `data` - the very same object reference as before - and it must be
      // treated as fresh, or nothing would ever repopulate the row's rate
      // and the row would stay disabled while still showing that rate.
      autoSelectedDataRef.current = undefined
      return
    }

    if (data.rates.length === 0) {
      return
    }

    if (autoSelectedDataRef.current === data) {
      return
    }
    autoSelectedDataRef.current = data

    const cheapest = data.rates[0]
    setSelectedRateId(cheapest.rate_id)
    onChange({ shipmentId: data.shipment_id, rateId: cheapest.rate_id })
  }, [data, onChange])

  if (!locationId) {
    // Nothing resolved a Ship From location for this row (no per-row pick,
    // no store default, no checkout location) - a quote can't succeed and
    // Retry can't fix it, so say what will.
    return (
      <div className="flex h-full w-full items-center overflow-hidden">
        <Text size="small" className="text-ui-fg-error truncate">
          {t("orders.readyToShip.noShipFromLocation")}
        </Text>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex h-full w-full items-center gap-x-2 overflow-hidden">
        <Text size="small" className="text-ui-fg-error truncate">
          {t("orders.readyToShip.shippingRateQuoteFailed")}
        </Text>
        <Button
          size="small"
          variant="secondary"
          onClick={(e) => {
            // Same reasoning as `ShipFromSelect`'s/`PackagePopover`'s
            // trigger: this cell sits inside `_DataTable`'s row `Link`, so
            // the click must stop here or it bubbles up and navigates to
            // the order detail page instead of retrying the quote.
            e.stopPropagation()
            refetch()
          }}
        >
          {t("orders.readyToShip.retry")}
        </Button>
      </div>
    )
  }

  const selectedRate = data?.rates.find((rate) => rate.rate_id === selectedRateId)

  return (
    <Select
      value={selectedRateId ?? undefined}
      onValueChange={(rateId) => {
        setSelectedRateId(rateId)
        if (data) {
          onChange({ shipmentId: data.shipment_id, rateId })
        }
      }}
      disabled={!data}
    >
      {/*
       * Same reasoning as `ShipFromSelect`'s trigger: this cell sits inside
       * `_DataTable`'s row `Link`, so the click must stop here or it
       * bubbles up and navigates to the order detail page instead of
       * opening the select. The `aria-label` names the order, since every
       * row's trigger otherwise shares the same "combobox" role.
       */}
      <Select.Trigger
        aria-label={`Shipping rate - order ${orderId}`}
        onClick={(e) => {
          e.stopPropagation()
        }}
      >
        <Select.Value placeholder={t("orders.readyToShip.quoting")}>
          {selectedRate ? formatRateLabel(selectedRate) : undefined}
        </Select.Value>
      </Select.Trigger>
      <Select.Content
        onClick={(e) => {
          e.stopPropagation()
        }}
      >
        {data?.rates.map((rate) => (
          <Select.Item key={rate.rate_id} value={rate.rate_id}>
            {formatRateLabel(rate)}
          </Select.Item>
        ))}
      </Select.Content>
    </Select>
  )
}
