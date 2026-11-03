import { Alert, Button, Popover, Text } from "@medusajs/ui"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import {
  BulkFulfillOrderFailure,
  useBulkFulfillOrders,
} from "../../../../../../hooks/api/orders"
import { useStockLocations } from "../../../../../../hooks/api/stock-locations"
import { getFulfillableQuantity } from "../../../../../../lib/order-item"
import { OrphanedLabelNotice } from "./bulk-fulfill-result-summary"
import {
  DisabledFulfillCell,
  ReadyToShipOrder,
  resolveShipFromLocationId,
} from "./ready-to-ship-table"

type FulfillConfirmPopoverProps = {
  order: ReadyToShipOrder
  // The admin's in-progress Ship From override and the live carrier rate
  // picked for each row, keyed by order id - the same `rowLocationOverride`/
  // `rowRates` state `ReadyToShipTable` passes (resolved per-row) to the
  // `ship_from`/`shipping_rate` columns' own cells. Passed down as the whole
  // dict, not pre-resolved for this order, since - unlike those columns -
  // this component also uses `rowRates[order.id]`'s mere presence (not just
  // its value) to gate `hasShippingMethod` below.
  rowLocationOverride: Record<string, string>
  rowRates: Record<string, { shipmentId: string; rateId: string }>
  // The store-wide default ship-from location, same prop
  // `ReadyToShipTable` resolves once (via `useStore`) and threads through to
  // the `ship_from`/`shipping_rate` columns' cells. Required here so this
  // component resolves `location_id` with the very same
  // `resolveShipFromLocationId` the bulk path (`buildBulkFulfillments`) and
  // those cells use - what's displayed, quoted against, and sent must
  // always be the same value.
  defaultLocationId: string | null
}

/**
 * Read-only confirmation popover for the Ready to Ship table's Fulfill
 * action. Shows the order's fulfillment location - resolved by
 * `resolveShipFromLocationId` (the admin's override, else the store-wide
 * default, else the checkout shipping option's own location as a last
 * resort), with its display name from `useStockLocations` - the *same*
 * resolution `buildBulkFulfillments` uses for the bulk path: what's
 * displayed here, what `ShippingRateSelect` quoted against, and what's
 * actually sent on confirm must always agree. Also
 * shows the order's remaining (unfulfilled) line items, using the same
 * `quantity - detail.fulfilled_quantity` formula as
 * `order-create-fulfillment-form.tsx` and `computeOrderParcel`. Confirm
 * calls `useBulkFulfillOrders` with a one-item `fulfillments` array built
 * from those values plus this row's quoted `rowRates` entry (the
 * shipment/rate id `ShippingRateSelect` picked) - this is a confirmation
 * display, never an editable form. An order that needs different
 * quantities still goes through the full fulfillment form on the order
 * detail page, which this plan leaves unchanged.
 *
 * `useBulkFulfillOrders`'s own `onSuccess` already invalidates
 * `ordersQueryKeys.all`, and `ReadyToShipTable`'s `useOrders` query key is
 * built under that same `orders` key hierarchy, so no additional
 * invalidation is needed here.
 *
 * Request-level failure (the mutation's promise rejecting - e.g. a network
 * error) and a structured per-order failure (the batch route always
 * resolves with HTTP 200, recording a failed fulfillment in the response's
 * own `failed` array instead - see `fulfillments/batch/route.ts`) both keep
 * the popover open and render the error message inline, per the design
 * spec's Error handling section - deliberately not a toast, unlike the
 * full fulfillment form's own error handling. Only a resolved response with
 * no `failed` entry for this order counts as success and closes the
 * popover.
 */
export const FulfillConfirmPopover = ({
  order,
  rowLocationOverride,
  rowRates,
  defaultLocationId,
}: FulfillConfirmPopoverProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  // The failure to show inline: a request-level error, or this order's own
  // `failed` entry - which may carry `easypost_shipment_id` when a label was
  // already bought before the fulfillment failed to be recorded.
  const [failure, setFailure] = useState<Pick<
    BulkFulfillOrderFailure,
    "error" | "easypost_shipment_id"
  > | null>(null)
  const { mutateAsync, isPending } = useBulkFulfillOrders()
  const { stock_locations } = useStockLocations()

  const shippingMethod = order.shipping_methods?.[0]
  // Deliberately `!!shippingMethod`, not `orderHasShippingMethod(order)`:
  // TS's control-flow narrowing of `shippingMethod` after the `if
  // (!hasShippingMethod) return` below only works for a directly aliased
  // condition - routing it through a separate function call would lose
  // that narrowing and need a cast everywhere `shippingMethod` is used
  // past this point. Both forms are equivalent; `orderHasShippingMethod`
  // exists for the bulk row-selection check in `ready-to-ship-table.tsx`,
  // which has no such narrowing to preserve.
  const hasShippingMethod = !!shippingMethod

  if (!hasShippingMethod) {
    return <DisabledFulfillCell />
  }

  // Per Task 11's note (quoting gates fulfillability): a shipping method
  // alone isn't enough to buy a label against - `rate` below is also
  // required, since `shipment_id`/`rate_id` are mandatory on the
  // fulfillments payload. A row whose quote is still loading or failed
  // renders a disabled button too, kept separate from `hasShippingMethod`
  // above only to preserve that existing narrowing comment's reasoning -
  // but with its own `"noRateYet"` tooltip, not `"noShippingMethod"`: this
  // row does have one, it's the rate that's missing.
  const rate = rowRates[order.id]

  if (!rate) {
    return <DisabledFulfillCell reason="noRateYet" />
  }

  // The exact same `resolveShipFromLocationId` the Ship From cell,
  // `ShippingRateSelect`'s quote and `buildBulkFulfillments` use - this row
  // was quoted against this exact `locationId`, so sending (and displaying)
  // anything else here would quote one address and buy a label for another.
  const locationId =
    resolveShipFromLocationId(order, rowLocationOverride, defaultLocationId) ??
    undefined
  const locationName =
    stock_locations?.find((location) => location.id === locationId)?.name ??
    t("fields.location")

  const fulfillableItems = (order.items ?? []).filter(
    (item) => getFulfillableQuantity(item) > 0
  )

  const handleOpenChange = (next: boolean) => {
    if (isPending) {
      return
    }

    setOpen(next)

    if (next) {
      setFailure(null)
    }
  }

  const handleConfirm = async () => {
    setFailure(null)

    try {
      const result = await mutateAsync({
        fulfillments: [
          {
            order_id: order.id,
            location_id: locationId,
            shipment_id: rate.shipmentId,
            rate_id: rate.rateId,
          },
        ],
      })

      // The batch route always resolves with HTTP 200 - a failed label
      // buy/fulfillment creation for this order is recorded in the
      // response's own `failed` array, not a rejected promise (see
      // `fulfillments/batch/route.ts`). Only the absence of a `failed`
      // entry for this order counts as success; finding one keeps the
      // popover open and surfaces that exact error, the same as a thrown
      // request-level error below.
      const orderFailure = result.failed.find((f) => f.order_id === order.id)

      if (orderFailure) {
        setFailure(orderFailure)
        return
      }

      setOpen(false)
    } catch (e) {
      setFailure({
        error: e instanceof Error ? e.message : t("errorBoundary.defaultTitle"),
      })
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {/*
       * `DisabledFulfillCell` isn't used as the trigger here: Radix's
       * `asChild` clones its injected props (ref, onClick, aria
       * attributes) onto the literal child element, which only works when
       * that child forwards them on to a real DOM node (as `Button`
       * does). `DisabledFulfillCell` is a plain function component that
       * ignores extra props, so the button below mirrors its rendering
       * (same label, size and variant) instead. The no-shipping-method
       * case above still reuses `DisabledFulfillCell` (and its `Tooltip`)
       * verbatim, since that branch never needs to compose with the
       * popover trigger.
       */}
      <Popover.Trigger asChild>
        <Button
          size="small"
          variant="secondary"
          onClick={(e) => {
            // This cell sits inside `_DataTable`'s own `navigateTo` `Link`
            // (`data-table-root.tsx`'s `shouldRenderAsLink`), which wraps
            // every non-`select` cell. `Link`'s own navigation is just
            // another React click handler (react-router is client-side
            // routing, not a real anchor follow), so stopping this
            // synthetic event from bubbling up to it - the same pattern
            // the "select" checkbox column and `ActionMenu` already use -
            // is enough to keep this click from navigating away instead of
            // opening the popover. Deliberately not `preventDefault`: Radix
            // composes this handler with its own open-toggle handler via
            // `composeEventHandlers`, which skips its handler once
            // `defaultPrevented` is set, so calling it here would stop the
            // popover from ever opening.
            e.stopPropagation()
          }}
        >
          {t("orders.readyToShip.fulfill")}
        </Button>
      </Popover.Trigger>
      <Popover.Content
        align="end"
        side="top"
        className="w-[320px] overflow-hidden"
        // Radix portals this content elsewhere in the DOM, but React's
        // synthetic event system still dispatches through the *original*
        // component tree (the row's `Link` is an ancestor there), so a
        // click on Confirm/Cancel/the content itself would otherwise still
        // bubble up to - and navigate via - that `Link`. Stopping it here
        // covers the whole popover (content background, Cancel, Confirm)
        // in one place rather than on each button individually.
        onClick={(e) => {
          e.stopPropagation()
        }}
      >
        <div className="flex flex-col gap-y-3 p-3">
          <Text size="small" weight="plus">
            {t("orders.readyToShip.confirmHeading")}
          </Text>

          <div className="flex flex-col gap-y-1">
            <Text size="xsmall" className="text-ui-fg-subtle">
              {t("fields.location")}
            </Text>
            <Text size="small">{locationName}</Text>
          </div>

          <div className="flex flex-col gap-y-1">
            <Text size="xsmall" className="text-ui-fg-subtle">
              {t("fields.items")}
            </Text>
            <div className="flex flex-col gap-y-0.5">
              {fulfillableItems.map((item) => (
                <Text size="small" key={item.id}>
                  {getFulfillableQuantity(item)}x {item.title}
                </Text>
              ))}
            </div>
          </div>

          {failure && (
            <Alert variant="error" dismissible={false} className="p-2">
              <div className="flex flex-col gap-y-1">
                <span>{failure.error}</span>
                {failure.easypost_shipment_id && (
                  <OrphanedLabelNotice
                    shipmentId={failure.easypost_shipment_id}
                  />
                )}
              </div>
            </Alert>
          )}

          <div className="flex items-center justify-end gap-x-2">
            <Popover.Close asChild>
              <Button size="small" variant="secondary" disabled={isPending}>
                {t("actions.cancel")}
              </Button>
            </Popover.Close>
            <Button
              size="small"
              type="button"
              isLoading={isPending}
              disabled={!fulfillableItems.length}
              onClick={handleConfirm}
            >
              {t("actions.confirm")}
            </Button>
          </div>
        </div>
      </Popover.Content>
    </Popover>
  )
}
