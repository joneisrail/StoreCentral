import { Select } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

import { useStockLocations } from "../../../../../../hooks/api/stock-locations"

type ShipFromSelectProps = {
  orderId: string
  defaultLocationId: string | null
  onChange: (locationId: string) => void
}

/**
 * The Ready to Ship table's Ship From column: a `Select` of the merchant's
 * stock locations. `defaultLocationId` is resolved by `ReadyToShipTable`
 * from the store-wide default (`store?.metadata?.default_ship_from_location_id`)
 * and that row's own override, if the admin has already picked one - this
 * component holds no selection state of its own, it's fully controlled by
 * the parent. `onChange` fires the instant a different location is picked;
 * there's no separate confirm step, unlike `PackagePopover`.
 */
export const ShipFromSelect = ({
  orderId,
  defaultLocationId,
  onChange,
}: ShipFromSelectProps) => {
  const { t } = useTranslation()
  const { stock_locations } = useStockLocations()

  const selectedLocation = stock_locations?.find(
    (location) => location.id === defaultLocationId
  )

  return (
    <Select value={defaultLocationId ?? undefined} onValueChange={onChange}>
      {/*
       * Same reasoning as `PackagePopover`'s/`FulfillConfirmPopover`'s
       * trigger: this cell sits inside `_DataTable`'s row `Link`, so the
       * click must stop here or it bubbles up and navigates to the order
       * detail page instead of opening the select. The `aria-label` names
       * the order, since every row's trigger otherwise shares the same
       * "combobox" role - ambiguous for screen reader users navigating a
       * table full of them.
       */}
      <Select.Trigger
        aria-label={`Ship from - order ${orderId}`}
        onClick={(e) => {
          e.stopPropagation()
        }}
      >
        <Select.Value placeholder={t("fields.location")}>
          {selectedLocation?.name}
        </Select.Value>
      </Select.Trigger>
      <Select.Content
        onClick={(e) => {
          e.stopPropagation()
        }}
      >
        {stock_locations?.map((location) => (
          <Select.Item key={location.id} value={location.id}>
            {location.name}
          </Select.Item>
        ))}
      </Select.Content>
    </Select>
  )
}
