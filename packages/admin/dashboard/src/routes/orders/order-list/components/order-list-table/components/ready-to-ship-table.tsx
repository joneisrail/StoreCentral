import { HttpTypes } from "@medusajs/types"
import { Button, Checkbox, Tooltip, toast, usePrompt } from "@medusajs/ui"
import { keepPreviousData } from "@tanstack/react-query"
import { createColumnHelper, RowSelectionState } from "@tanstack/react-table"
import { useCallback, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"

import { _DataTable } from "../../../../../../components/table/data-table/data-table"
import { DateCell } from "../../../../../../components/table/table-cells/common/date-cell"
import {
  CustomerCell,
  CustomerHeader,
} from "../../../../../../components/table/table-cells/order/customer-cell"
import {
  DisplayIdCell,
  DisplayIdHeader,
} from "../../../../../../components/table/table-cells/order/display-id-cell"
import {
  TotalCell,
  TotalHeader,
} from "../../../../../../components/table/table-cells/order/total-cell"
import {
  BulkFulfillOrdersResult,
  useBulkFulfillOrders,
  useOrders,
} from "../../../../../../hooks/api/orders"
import { useHeldOrderIds, useHoldTag } from "../../../../../../hooks/api/order-holds"
import { useStore } from "../../../../../../hooks/api/store"
import { useDataTable } from "../../../../../../hooks/use-data-table"
import { getStylizedAmount } from "../../../../../../lib/money-amount-helpers"
import {
  computeOrderParcel,
  formatPackageField,
  OrderParcel,
} from "../../../../../../lib/order-parcel"
import { READY_TO_SHIP_FIELDS } from "../../../const"
import { getViewQuery } from "../../../order-views"
import { BulkFulfillResultSummary } from "./bulk-fulfill-result-summary"
import { FulfillConfirmPopover } from "./fulfill-confirm-popover"
import { ItemCell } from "./item-cell"
import { PackagePopover, PackageSelection } from "./package-popover"
import { ShipDateCell, ShipTimeCell } from "./ship-by-cell"
import { ShipFromSelect } from "./ship-from-select"
import { ShippingRateSelect } from "./shipping-rate-select"

// Re-exported for Task 11/13 (re-quoting carrier rates and buying the
// fulfillment) to import the exact payload shape `rowPackages` below is
// keyed with, without reaching into `package-popover.tsx` directly.
export type { PackageSelection }

const PAGE_SIZE = 20
const QUERY_PREFIX = "rts"

/**
 * The order's shipping method, augmented with the nested relation chain
 * down to the shipping option's location. The base `AdminOrderShippingMethod`
 * type only declares `shipping_option_id`, not a `shipping_option` relation -
 * this mirrors the local augmentation pattern used for order fulfillments
 * in `order-detail/constants.ts`.
 */
export type ReadyToShipShippingMethod = HttpTypes.AdminOrderShippingMethod & {
  shipping_option?: {
    service_zone?: {
      fulfillment_set?: {
        location?: {
          id?: string | null
          name?: string | null
        } | null
      } | null
    } | null
  } | null
}

export type ReadyToShipOrder = Omit<
  HttpTypes.AdminOrder,
  "shipping_methods"
> & {
  shipping_methods?: ReadyToShipShippingMethod[] | null
}

export const getShipFromLocationName = (
  shippingMethod?: ReadyToShipShippingMethod | null
): string | null =>
  shippingMethod?.shipping_option?.service_zone?.fulfillment_set?.location
    ?.name ?? null

/**
 * Resolves the stock location's id from the same shipping method ->
 * shipping option -> service zone -> fulfillment set -> location chain as
 * `getShipFromLocationName`. Used by `FulfillConfirmPopover` to build the
 * fulfillment payload's `location_id` - the `name` alone isn't a usable id.
 */
export const getShipFromLocationId = (
  shippingMethod?: ReadyToShipShippingMethod | null
): string | null =>
  shippingMethod?.shipping_option?.service_zone?.fulfillment_set?.location
    ?.id ?? null

/**
 * THE single place a Ready to Ship row's Ship From location is resolved.
 * Every site that needs it - the Ship From cell's displayed value, the
 * carrier-rates quote (`ShippingRateSelect`), the single-row Fulfill send
 * (`FulfillConfirmPopover`) and the bulk Fulfill send
 * (`buildBulkFulfillments`) - goes through this, so what's displayed, what's
 * quoted against and what's bought can never disagree.
 *
 * Priority: the admin's per-row override, then the store-wide default
 * (Settings > Fulfillment), then - only as a last resort, for a store that
 * hasn't configured a default yet - the location the order's checkout
 * shipping method's shipping option is linked to. Returns `null` when none
 * of those resolve; callers then show an actionable "set a default ship-from
 * location" message instead of attempting a quote that can't succeed.
 */
export const resolveShipFromLocationId = (
  order: Pick<ReadyToShipOrder, "id" | "shipping_methods">,
  rowLocationOverride: Record<string, string>,
  defaultLocationId: string | null
): string | null =>
  rowLocationOverride[order.id] ??
  defaultLocationId ??
  getShipFromLocationId(order.shipping_methods?.[0]) ??
  null

/**
 * Resolves the `handling_hours` SLA the Ship Date and Ship Time columns
 * both compute their shared deadline from (via `computeShipDeadline`),
 * written to `sales_channel.metadata` by the Settings > Fulfillment page
 * (Task 7). Requires `+sales_channel.metadata` on
 * `READY_TO_SHIP_RELATIONS` - `*sales_channel` alone doesn't reliably
 * expand a `metadata` json column. Returns `null` (rather than throwing or
 * coercing) for a sales channel with no `handling_hours` configured, or no
 * `metadata` at all - `ShipDateCell`/`ShipTimeCell` render their shared
 * "No SLA set" state for that case rather than fabricating a deadline.
 */
export const getHandlingHours = (
  salesChannel?: { metadata?: Record<string, unknown> | null } | null
): number | null => {
  const value = salesChannel?.metadata?.handling_hours

  return typeof value === "number" ? value : null
}

/**
 * Whether the order has a shipping method at all - the baseline
 * precondition the Shipping Rate/Ship From columns, the Fulfill button
 * (`FulfillConfirmPopover`/`DisabledFulfillCell`), and the bulk row
 * selection checkbox below all gate on. Centralized here so the bulk
 * checkbox can't drift from the single-row Fulfill button's own guard.
 *
 * This alone isn't sufficient to fulfill, though: both the bulk checkbox
 * (`enableRowSelection` below) and `FulfillConfirmPopover` additionally
 * require a quoted carrier rate to already be on hand for the order
 * (`rowRates[order.id]`) - per Task 11's note that quoting gates
 * fulfillability, since buying a label needs the `shipment_id`/`rate_id`
 * that quote provides.
 */
export const orderHasShippingMethod = (
  order: Pick<ReadyToShipOrder, "shipping_methods">
): boolean => !!order.shipping_methods?.[0]

/**
 * Renders the stock location a Ready to Ship order will fulfill from,
 * resolved via the order's shipping method -> shipping option -> service
 * zone -> fulfillment set -> location chain (the pre-fulfillment path - an
 * order with no `Fulfillment` record yet has nothing for
 * `fulfillment.location_id` to read). Renders empty when there is no
 * shipping method to resolve from at all, or when the location can't be
 * resolved - the same precondition the Shipping Rate column fails under.
 */
export const ShipFromCell = ({
  shippingMethod,
}: {
  shippingMethod?: ReadyToShipShippingMethod | null
}) => {
  const locationName = getShipFromLocationName(shippingMethod)

  if (!locationName) {
    return null
  }

  return (
    <div className="flex h-full w-full items-center overflow-hidden">
      <span className="truncate">{locationName}</span>
    </div>
  )
}

/**
 * Renders the parcel computed from the order's unfulfilled items. Each
 * missing weight/length/width/height field renders as "Not set" rather
 * than a fabricated default.
 */
export const PackageCell = ({
  items,
}: {
  items: HttpTypes.AdminOrderLineItem[]
}) => {
  const { t } = useTranslation()
  const notSetLabel = t("orders.readyToShip.notSet")
  const parcel = computeOrderParcel(items)

  return (
    <div className="flex h-full w-full flex-col justify-center gap-y-0.5 overflow-hidden py-1">
      <span className="truncate">
        {t("orders.readyToShip.weight")}:{" "}
        {formatPackageField(parcel.weight, notSetLabel)}
      </span>
      <span className="truncate text-ui-fg-subtle">
        {formatPackageField(parcel.length, notSetLabel)} x{" "}
        {formatPackageField(parcel.width, notSetLabel)} x{" "}
        {formatPackageField(parcel.height, notSetLabel)}
      </span>
    </div>
  )
}

/**
 * Renders the order's first shipping method's name and formatted amount.
 * A $0 (free shipping) amount still renders a value: the guard below only
 * short-circuits on a missing `shippingMethod`, so `getStylizedAmount` -
 * which takes a required `number` and has no null/undefined handling of
 * its own - is only ever called with a real amount, never with the "no
 * shipping method at all" case. That's what keeps the two visibly
 * distinct, not any null-safety in `getStylizedAmount` itself.
 */
export const ShippingRateCell = ({
  shippingMethod,
  currencyCode,
}: {
  shippingMethod?: ReadyToShipShippingMethod | null
  currencyCode: string
}) => {
  if (!shippingMethod) {
    return null
  }

  return (
    <div className="flex h-full w-full items-center gap-x-1.5 overflow-hidden">
      <span className="truncate">{shippingMethod.name}</span>
      <span className="truncate text-ui-fg-subtle">
        {getStylizedAmount(shippingMethod.amount, currencyCode)}
      </span>
    </div>
  )
}

/**
 * Renders the disabled Fulfill button for an order that can't be fulfilled
 * yet. `FulfillConfirmPopover` renders this directly, for either of two
 * distinct reasons - no shipping method at all (the same precondition the
 * Shipping Rate and Ship From columns fail under), or a shipping method but
 * no quoted carrier rate yet (still loading, or the quote failed) - and
 * wires up the real confirm popover itself for every order that has both,
 * so this component only ever renders a disabled state, never the enabled
 * one. `reason` picks which tooltip explains *why*: defaults to
 * `"noShippingMethod"` since that's `ready-to-ship-table.spec.tsx`'s own
 * direct usage of this component (its own tests predate `reason` existing
 * at all), but every caller should pass the one that actually applies
 * rather than relying on the default.
 */
export const DisabledFulfillCell = ({
  reason = "noShippingMethod",
}: {
  reason?: "noShippingMethod" | "noRateYet"
} = {}) => {
  const { t } = useTranslation()
  const tooltipKey =
    reason === "noRateYet"
      ? "orders.readyToShip.noRateYet"
      : "orders.readyToShip.noShippingMethod"

  return (
    <Tooltip content={t(tooltipKey)}>
      <Button size="small" variant="secondary" disabled>
        {t("orders.readyToShip.fulfill")}
      </Button>
    </Tooltip>
  )
}

/**
 * Coerces whichever parcel shape a row's Package column currently holds
 * into the single `PackageSelection` shape `ShippingRateSelect`/
 * `useOrderCarrierRates` require: either the admin's confirmed
 * `PackageSelection` (Task 9, written via `setRowPackage` - already has a
 * required, validated `weight`), or, before any package has been confirmed
 * yet, the raw `OrderParcel` `computeOrderParcel` derives from the order's
 * own items (whose `weight`/dimensions are nullable). A `null` weight (no
 * unfulfilled item has one) becomes `0` rather than failing to type-check -
 * EasyPost still rejects a 0-weight parcel, which surfaces through
 * `ShippingRateSelect`'s existing inline error + retry, the same place any
 * other unquotable parcel would.
 */
const toShippingRateParcel = (
  parcel: PackageSelection | OrderParcel
): PackageSelection => ({
  predefinedPackage:
    "predefinedPackage" in parcel ? parcel.predefinedPackage : undefined,
  weight: parcel.weight ?? 0,
  length: parcel.length ?? undefined,
  width: parcel.width ?? undefined,
  height: parcel.height ?? undefined,
})

/**
 * Whether two `PackageSelection`s describe the same parcel, field by field.
 * Used by `setRowPackage` below to recognize a "no-op" confirm - the admin
 * reopens the Package popover and confirms the exact same preset/custom
 * values without changing anything - so it can skip clearing that row's
 * quoted rate: `PackagePopover`'s own confirm handlers call `onChange`
 * unconditionally on every confirm, whether or not the selection actually
 * changed, so this comparison has to happen on the receiving end.
 */
export const isSamePackageSelection = (
  a: PackageSelection,
  b: PackageSelection
): boolean =>
  a.predefinedPackage === b.predefinedPackage &&
  a.weight === b.weight &&
  a.length === b.length &&
  a.width === b.width &&
  a.height === b.height

export type BulkFulfillmentEntry = {
  order_id: string
  location_id?: string
  shipment_id: string
  rate_id: string
}

/**
 * Builds the bulk "Fulfill selected" command's `fulfillments` payload from
 * the selected order ids plus this component's own per-row state
 * (`rowLocationOverride`/`rowRates`), resolving each order's location with
 * `resolveShipFromLocationId` - the same resolution the `ship_from`/
 * `shipping_rate` columns' cells use. `orders` supplies each order's
 * shipping method for that resolution's last-resort fallback; an order
 * missing from it simply skips that fallback. A selected order with no
 * `rowRates` entry yet is skipped
 * rather than sent with a missing `shipment_id`/`rate_id` - `enableRowSelection`
 * already keeps such an order from being selected via the checkbox in the
 * first place, but this re-checks at submit time rather than trusting that
 * selection-time gate never goes stale, and reports which order ids (if
 * any) it had to skip so the caller can surface that to the admin.
 *
 * Extracted as a pure function (rather than inlined in the command's
 * `action`) so this skip behavior - easy to leave as an untested
 * assumption, since `enableRowSelection` makes it unreachable through the
 * checkbox UI in this same render - has a direct, isolated test of its own.
 */
export const buildBulkFulfillments = (
  orderIds: string[],
  rowLocationOverride: Record<string, string>,
  rowRates: Record<string, { shipmentId: string; rateId: string }>,
  defaultLocationId: string | null,
  orders: Pick<ReadyToShipOrder, "id" | "shipping_methods">[] = []
): { fulfillments: BulkFulfillmentEntry[]; skippedOrderIds: string[] } => {
  const skippedOrderIds: string[] = []
  const ordersById = new Map(orders.map((order) => [order.id, order]))

  const fulfillments = orderIds.reduce<BulkFulfillmentEntry[]>(
    (acc, orderId) => {
      const rate = rowRates[orderId]

      if (!rate) {
        skippedOrderIds.push(orderId)
        return acc
      }

      acc.push({
        order_id: orderId,
        location_id:
          resolveShipFromLocationId(
            ordersById.get(orderId) ?? { id: orderId },
            rowLocationOverride,
            defaultLocationId
          ) ?? undefined,
        shipment_id: rate.shipmentId,
        rate_id: rate.rateId,
      })

      return acc
    },
    []
  )

  return { fulfillments, skippedOrderIds }
}

const columnHelper = createColumnHelper<ReadyToShipOrder>()

const useReadyToShipTableColumns = (
  rowPackages: Record<string, PackageSelection>,
  setRowPackage: (
    orderId: string,
    parcel: PackageSelection,
    baselineParcel: OrderParcel
  ) => void,
  defaultLocationId: string | null,
  rowLocationOverride: Record<string, string>,
  setRowLocationOverride: (orderId: string, locationId: string) => void,
  rowRates: Record<string, { shipmentId: string; rateId: string }>,
  setRowRate: (orderId: string, rate: { shipmentId: string; rateId: string }) => void
) => {
  const { t } = useTranslation()

  // `_DataTable` (via TanStack Table's own `flexRender`, which does
  // `React.createElement(columnDef.cell, props)` - see
  // `node_modules/@tanstack/react-table`) uses each column's `cell`
  // function itself as the rendered element's component *type*, not just
  // as a plain render-prop call. That means regenerating this array - a
  // brand new `cell` function reference for every column - makes React
  // treat every cell as a *different* component type and remount it from
  // scratch, discarding whatever state/refs it held. For
  // `ShippingRateSelect` in particular that's catastrophic: a remount
  // resets its own `autoSelectedDataRef` auto-select guard, so the fresh
  // instance treats the still-same quote as newly arrived, calls
  // `onChange` again, which calls `setRowRate` again, which changes
  // `rowRates` again, which (if this memo depended on it) would
  // regenerate this array again - an infinite render loop.
  //
  // So this array must be created exactly once and never recomputed for
  // the lifetime of the table - not just excluding `rowPackages`/
  // `rowLocationOverride`/`rowRates` from the dependency array below, but
  // `t` too: `useTranslation`'s own `t` is stable in the real
  // `react-i18next`, but several of this codebase's tests stub it with a
  // fresh closure every render, which would otherwise retrigger the exact
  // same loop. Every value these cells need is instead read through a ref,
  // updated eagerly on every render below, so each cell still renders the
  // current value - the `cell`/`header` functions themselves still run
  // fresh on every actual render regardless of this memo's own identity.
  const tRef = useRef(t)
  tRef.current = t
  const defaultLocationIdRef = useRef(defaultLocationId)
  defaultLocationIdRef.current = defaultLocationId
  const rowPackagesRef = useRef(rowPackages)
  rowPackagesRef.current = rowPackages
  const rowLocationOverrideRef = useRef(rowLocationOverride)
  rowLocationOverrideRef.current = rowLocationOverride
  const rowRatesRef = useRef(rowRates)
  rowRatesRef.current = rowRates

  return useMemo(
    () => [
      columnHelper.display({
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsSomePageRowsSelected()
                ? "indeterminate"
                : table.getIsAllPageRowsSelected()
            }
            onCheckedChange={(value) =>
              table.toggleAllPageRowsSelected(!!value)
            }
          />
        ),
        cell: ({ row }) => {
          // `enableRowSelection` (set on `useDataTable` below, keyed off
          // the same `orderHasShippingMethod` check the single-row Fulfill
          // button uses) makes `getCanSelect()` false for an order with no
          // shipping method - mirrored here so the bulk checkbox can't
          // select an order the single-row path would already refuse to
          // fulfill, which would otherwise only fail later, server-side,
          // once the batch runs.
          const isSelectable = row.getCanSelect()

          return (
            <Checkbox
              disabled={!isSelectable}
              checked={row.getIsSelected()}
              onCheckedChange={(value) => row.toggleSelected(!!value)}
              onClick={(e) => {
                e.stopPropagation()
              }}
            />
          )
        },
      }),
      columnHelper.accessor("display_id", {
        header: () => <DisplayIdHeader />,
        cell: ({ getValue }) => <DisplayIdCell displayId={getValue()} />,
      }),
      columnHelper.accessor("customer", {
        header: () => <CustomerHeader />,
        cell: ({ getValue }) => <CustomerCell customer={getValue()} />,
      }),
      columnHelper.display({
        id: "item",
        header: () => (
          <div className="flex h-full w-full items-center">
            <span className="truncate">{tRef.current("fields.items")}</span>
          </div>
        ),
        cell: ({ row }) => <ItemCell items={row.original.items ?? []} />,
      }),
      columnHelper.display({
        id: "ship_from",
        header: () => (
          <div className="flex h-full w-full items-center">
            <span className="truncate">
              {tRef.current("orders.readyToShip.shipFrom")}
            </span>
          </div>
        ),
        cell: ({ row }) => (
          <ShipFromSelect
            orderId={row.original.id}
            defaultLocationId={resolveShipFromLocationId(
              row.original,
              rowLocationOverrideRef.current,
              defaultLocationIdRef.current
            )}
            onChange={(id) => setRowLocationOverride(row.original.id, id)}
          />
        ),
      }),
      columnHelper.display({
        id: "package",
        header: () => (
          <div className="flex h-full w-full items-center">
            <span className="truncate">
              {tRef.current("orders.readyToShip.package")}
            </span>
          </div>
        ),
        cell: ({ row }) => {
          // Computed once per render and reused for both props: it's
          // `PackagePopover`'s starting point *and* the baseline
          // `setRowPackage` falls back to below when this row has no
          // explicit prior selection yet - the same parcel `rowRates` was
          // actually quoted against in that case (see the
          // `shipping_rate` column's cell further down).
          const baselineParcel = computeOrderParcel(row.original.items ?? [])

          return (
            <PackagePopover
              initialParcel={baselineParcel}
              // Controlled by `rowPackages` (which survives paging), so the
              // trigger always shows the package this row is actually
              // quoted and fulfilled with - not a snapshot from mount time.
              selection={rowPackagesRef.current[row.original.id]}
              onChange={(parcel) =>
                setRowPackage(row.original.id, parcel, baselineParcel)
              }
            />
          )
        },
      }),
      columnHelper.display({
        id: "shipping_rate",
        header: () => (
          <div className="flex h-full w-full items-center">
            <span className="truncate">
              {tRef.current("orders.readyToShip.shippingRate")}
            </span>
          </div>
        ),
        cell: ({ row }) => (
          <ShippingRateSelect
            orderId={row.original.id}
            locationId={resolveShipFromLocationId(
              row.original,
              rowLocationOverrideRef.current,
              defaultLocationIdRef.current
            )}
            parcel={toShippingRateParcel(
              rowPackagesRef.current[row.original.id] ??
                computeOrderParcel(row.original.items ?? [])
            )}
            onChange={(rate) => setRowRate(row.original.id, rate)}
          />
        ),
      }),
      columnHelper.accessor("created_at", {
        header: () => (
          <div className="flex h-full w-full items-center">
            <span className="truncate">
              {tRef.current("orders.readyToShip.orderDate")}
            </span>
          </div>
        ),
        cell: ({ getValue }) => <DateCell date={getValue()} />,
      }),
      columnHelper.display({
        id: "ship_date",
        header: () => (
          <div className="flex h-full w-full items-center">
            <span className="truncate">
              {tRef.current("orders.readyToShip.shipDate")}
            </span>
          </div>
        ),
        cell: ({ row }) => (
          <ShipDateCell
            createdAt={row.original.created_at}
            handlingHours={getHandlingHours(row.original.sales_channel)}
          />
        ),
      }),
      columnHelper.display({
        id: "ship_time",
        header: () => (
          <div className="flex h-full w-full items-center">
            <span className="truncate">
              {tRef.current("orders.readyToShip.shipTime")}
            </span>
          </div>
        ),
        cell: ({ row }) => (
          <ShipTimeCell
            createdAt={row.original.created_at}
            handlingHours={getHandlingHours(row.original.sales_channel)}
          />
        ),
      }),
      columnHelper.accessor("total", {
        header: () => <TotalHeader />,
        cell: ({ getValue, row }) => (
          <TotalCell
            currencyCode={row.original.currency_code}
            total={getValue()}
          />
        ),
      }),
      columnHelper.display({
        id: "fulfill",
        cell: ({ row }) => (
          <FulfillConfirmPopover
            order={row.original}
            rowLocationOverride={rowLocationOverrideRef.current}
            rowRates={rowRatesRef.current}
            defaultLocationId={defaultLocationIdRef.current}
          />
        ),
      }),
    ],
    // Deliberately not `t`/`defaultLocationId`/`rowPackages`/
    // `rowLocationOverride`/`rowRates` themselves - see the refs declared
    // above this `useMemo` for why. Only the mutation setters remain here:
    // all three are already stable (`useCallback` with an empty dependency
    // array in `ReadyToShipTable` below), so this array is, in effect,
    // created exactly once for the table's lifetime.
    [setRowPackage, setRowLocationOverride, setRowRate]
  )
}

/**
 * The "Ready to Ship" order list view, inspired by Veeqo's fulfillment
 * list UX - not a Veeqo integration. Shows orders that are
 * `not_fulfilled`/`partially_fulfilled` and `captured`/`partially_captured`,
 * with the information a warehouse operator needs to ship them: where
 * they'll ship from, the computed parcel, and the chosen shipping rate.
 */
export const ReadyToShipTable = () => {
  const { t } = useTranslation()
  const prompt = usePrompt()
  const [searchParams] = useSearchParams()

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [bulkFulfillResult, setBulkFulfillResult] =
    useState<BulkFulfillOrdersResult | null>(null)
  // Guards the *entire* bulk-fulfill flow below (confirm prompt through the
  // mutation settling), not just the mutation call itself - each
  // fulfillment buys a real EasyPost shipping label, so a second click or
  // repeated "f" keypress while one batch (or even its confirm prompt) is
  // still in flight must be a no-op rather than firing a second, possibly
  // overlapping request for the same selection.
  const [isBulkFulfilling, setIsBulkFulfilling] = useState(false)
  // The live carrier rate picked for each row - the cheapest quoted rate by
  // default, or whichever rate the admin picks from the `shipping_rate`
  // column's dropdown - written by `ShippingRateSelect`'s `onChange`. Same
  // keyed-by-order-id shape as `rowPackages`/`rowLocationOverride` below.
  // Consumed by `enableRowSelection` and the bulk command's `action` below
  // (a row with no entry here isn't selectable/fulfillable yet - its quote
  // is still loading or failed) and passed down to `FulfillConfirmPopover`
  // for the single-row Fulfill action.
  //
  // Declared before `rowPackages`/`rowLocationOverride` below (rather than
  // alongside `rowRates`'s own `setRowRate`, which would read more
  // naturally next to them) specifically so `setRowPackage`/
  // `setRowLocationOverride` can close over the already-initialized
  // `clearRowRate` below - `const` bindings are in scope for a closure
  // regardless of source order (the closures aren't *called* until long
  // after this render finishes), but only once their own declaration has
  // actually run earlier in *this* render pass.
  const [rowRates, setRowRates] = useState<
    Record<string, { shipmentId: string; rateId: string }>
  >({})

  const setRowRate = useCallback(
    (orderId: string, rate: { shipmentId: string; rateId: string }) => {
      setRowRates((prev) => ({ ...prev, [orderId]: rate }))
    },
    []
  )

  // Invalidates a row's quoted rate - called whenever that row's Ship From
  // or Package selection changes (`setRowPackage`/`setRowLocationOverride`
  // below), since either one changes `ShippingRateSelect`'s own query key
  // and therefore what it's actually quoting against. Without this, the
  // *stale* rate stays in `rowRates` (and keeps gating `enableRowSelection`/
  // `FulfillConfirmPopover` open) for the entire window between "the
  // location/package changed" and "the new quote resolves" - a fulfillment
  // confirmed in that window would buy a label whose EasyPost
  // shipment/parcel no longer matches the `location_id` actually being
  // sent. `ShippingRateSelect`'s own auto-select effect naturally
  // repopulates this once its new quote arrives (or leaves it cleared, if
  // the new quote fails), so this only needs to clear it, never set a new
  // value itself.
  const clearRowRate = useCallback((orderId: string) => {
    setRowRates((prev) => {
      if (!(orderId in prev)) {
        return prev
      }

      const next = { ...prev }
      delete next[orderId]
      return next
    })
  }, [])

  // The admin's in-progress Package selections, keyed by order id - written
  // by `PackagePopover`'s `onChange` via the `package` column's cell below.
  // Read by the `shipping_rate` column's cell to re-quote carrier rates
  // against the chosen package (falling back to the order's computed
  // parcel for a row with no confirmed package yet).
  const [rowPackages, setRowPackages] = useState<Record<string, PackageSelection>>(
    {}
  )

  // A "latest" ref so `setRowPackage` below can read the row's *previous*
  // package without needing `rowPackages` itself in its own dependency
  // array (which would make it a new closure every time any row's package
  // changes, defeating the whole point of keeping it stable - same
  // reasoning as the refs in `useReadyToShipTableColumns`).
  const rowPackagesRef = useRef(rowPackages)
  rowPackagesRef.current = rowPackages

  // A stable identity (`clearRowRate` is itself stable too, so this closure
  // never changes reference across renders) so it doesn't force
  // `useReadyToShipTableColumns`'s `useMemo` to recompute every render just
  // because this closure is new.
  const setRowPackage = useCallback(
    (
      orderId: string,
      parcel: PackageSelection,
      baselineParcel: OrderParcel
    ) => {
      const previous = rowPackagesRef.current[orderId]

      setRowPackages((prev) => ({ ...prev, [orderId]: parcel }))

      // `PackagePopover`'s own confirm handlers call `onChange`
      // unconditionally on every confirm, whether or not the admin
      // actually changed anything - re-confirming the same preset/custom
      // values is a real, easy-to-hit path (reopen the popover, click
      // Confirm again), and so is confirming a *row's very first*
      // selection without touching anything, since the popover always
      // opens pre-filled from `baselineParcel`. Either way, the parcel
      // `rowRates` was actually quoted against - `rowPackagesRef.current`
      // when this row already has an explicit selection, else
      // `baselineParcel` itself, exactly mirroring the `??` fallback the
      // `shipping_rate` column's cell uses to build that same quote - is
      // what has to be compared, not just whether a prior *explicit*
      // selection existed. Both sides go through `toShippingRateParcel`
      // so an `OrderParcel`'s nullable fields and a `PackageSelection`'s
      // optional ones compare like for like. Only clear this row's quoted
      // rate when that effective parcel *actually* changed; otherwise the
      // row would be stuck disabled on an unrelated no-op confirm until
      // some other change happened to trigger a fresh quote.
      const previousEffective = toShippingRateParcel(previous ?? baselineParcel)
      const nextEffective = toShippingRateParcel(parcel)

      if (!isSamePackageSelection(previousEffective, nextEffective)) {
        clearRowRate(orderId)
      }
    },
    [clearRowRate]
  )

  // The admin's in-progress Ship From overrides, keyed by order id - written
  // by `ShipFromSelect`'s `onChange` via the `ship_from` column's cell
  // below. Same keyed-by-order-id shape as `rowPackages` above. A row with
  // no entry here falls back to the store-wide `defaultLocationId`.
  const [rowLocationOverride, setRowLocationOverrideState] = useState<
    Record<string, string>
  >({})

  const setRowLocationOverride = useCallback(
    (orderId: string, locationId: string) => {
      setRowLocationOverrideState((prev) => ({ ...prev, [orderId]: locationId }))
      clearRowRate(orderId)
    },
    [clearRowRate]
  )

  // The store-wide default ship-from location, written by the Fulfillment
  // settings page - resolved once here rather than per row, since every row
  // without its own override falls back to the same value.
  const { store } = useStore()
  const defaultLocationId =
    (store?.metadata?.default_ship_from_location_id as string | undefined) ??
    null

  const offsetKey = `${QUERY_PREFIX}_offset`
  const offset = Number(searchParams.get(offsetKey) ?? 0)

  // The query comes from the same `getViewQuery` the tab's count uses, so
  // the rows equal the count (held orders excluded). The table does not
  // fetch until the hold tag and held ids resolve, and errors if either
  // lookup failed (or the held set was truncated) rather than list held
  // orders.
  const {
    tagId,
    isLoading: tagLoading,
    isError: tagError,
  } = useHoldTag()
  const {
    ids: heldIds,
    isLoading: heldLoading,
    isError: heldError,
  } = useHeldOrderIds()
  const lookupLoading = tagLoading || heldLoading
  const lookupError = tagError || heldError

  const { orders, count, isLoading, isError, error } = useOrders(
    {
      fields: READY_TO_SHIP_FIELDS,
      ...getViewQuery("ready-to-ship", { heldIds, holdTagId: tagId }),
      limit: PAGE_SIZE,
      offset,
      order: "-created_at",
    } as HttpTypes.AdminOrderFilters,
    {
      placeholderData: keepPreviousData,
      enabled: !lookupLoading && !lookupError,
    }
  )

  const columns = useReadyToShipTableColumns(
    rowPackages,
    setRowPackage,
    defaultLocationId,
    rowLocationOverride,
    setRowLocationOverride,
    rowRates,
    setRowRate
  )

  const { mutateAsync: bulkFulfillOrders } = useBulkFulfillOrders()

  const { table } = useDataTable({
    data: (orders as ReadyToShipOrder[] | undefined) ?? [],
    columns,
    count,
    enablePagination: true,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
    prefix: QUERY_PREFIX,
    // Keyed off the same `shipping_methods` check the single-row Fulfill
    // button (`FulfillConfirmPopover`/`DisabledFulfillCell`) already gates
    // on - see `orderHasShippingMethod` - plus a quoted carrier rate
    // already being on hand for the row (`rowRates`), since buying a label
    // needs the `shipment_id`/`rate_id` that quote provides. Neither check
    // alone is enough; an order can have a shipping method but still be
    // mid-quote (or have a failed quote) when the admin selects it.
    enableRowSelection: (row) =>
      orderHasShippingMethod(row.original) && !!rowRates[row.original.id],
    rowSelection: {
      state: rowSelection,
      updater: setRowSelection,
    },
  })

  if (lookupError) {
    throw new Error("Could not determine which orders are on hold")
  }

  if (isError) {
    throw error
  }

  return (
    <>
      <_DataTable
        columns={columns}
        table={table}
        pagination
        navigateTo={(row) => `/orders/${row.original.id}`}
        count={count}
        isLoading={isLoading || lookupLoading}
        pageSize={PAGE_SIZE}
        prefix={QUERY_PREFIX}
        noRecords={{
          message: t("orders.readyToShip.noRecordsMessage"),
        }}
        commands={[
          {
            // `_DataTable`'s own `handleAction` clears `rowSelection` once
            // this returned promise resolves (`data-table-root.tsx`'s
            // `handleAction` calls `table.resetRowSelection()` after
            // `action(...)` settles), so this never resets it itself -
            // doing so here too would just duplicate that guarantee. The
            // catch below keeps this promise always resolving (a
            // request-level failure, as opposed to a per-order one in the
            // structured result, still surfaces via a toast) so that
            // clear-on-settle always runs.
            //
            // The `isBulkFulfilling` guard below covers a second click or
            // a repeated "f" keypress arriving while a prior invocation
            // (confirm prompt or mutation) hasn't settled yet - the
            // command bar/keyboard shortcut (`command-bar.tsx`'s
            // `Command`) has no such guard of its own.
            action: async (selection) => {
              if (isBulkFulfilling) {
                return
              }

              setIsBulkFulfilling(true)

              try {
                const orderIds = Object.keys(selection)

                const confirmed = await prompt({
                  title: t("general.areYouSure"),
                  description: t(
                    "orders.readyToShip.fulfillSelectedConfirmDescription",
                    { count: orderIds.length }
                  ),
                  confirmText: t("actions.continue"),
                  cancelText: t("actions.cancel"),
                })

                if (!confirmed) {
                  return
                }

                const { fulfillments, skippedOrderIds } = buildBulkFulfillments(
                  orderIds,
                  rowLocationOverride,
                  rowRates,
                  defaultLocationId,
                  (orders as ReadyToShipOrder[] | undefined) ?? []
                )

                if (skippedOrderIds.length > 0) {
                  toast.error(
                    t("orders.readyToShip.fulfillSelectedRateNotReady", {
                      count: skippedOrderIds.length,
                    })
                  )
                }

                if (fulfillments.length === 0) {
                  return
                }

                const result = await bulkFulfillOrders({ fulfillments })
                setBulkFulfillResult(result)
              } catch (e) {
                toast.error(
                  e instanceof Error
                    ? e.message
                    : t("errorBoundary.defaultTitle")
                )
              } finally {
                setIsBulkFulfilling(false)
              }
            },
            label: t("orders.readyToShip.fulfillSelected"),
            shortcut: "f",
          },
        ]}
      />
      {bulkFulfillResult && (
        <BulkFulfillResultSummary
          result={bulkFulfillResult}
          onDismiss={() => setBulkFulfillResult(null)}
        />
      )}
    </>
  )
}
