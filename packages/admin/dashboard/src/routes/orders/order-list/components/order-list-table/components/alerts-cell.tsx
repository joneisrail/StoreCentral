import { ExclamationCircleSolid } from "@medusajs/icons"
import { Tooltip } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

import { useOrderCarrierRates } from "../../../../../../hooks/api/orders"
import { computeOrderAlerts, OrderAlertQuote } from "../../order-alerts"
import type { PackageSelection, ReadyToShipOrder } from "./ready-to-ship-table"

type AlertsCellProps = {
  order: ReadyToShipOrder
  // The same `locationId`/`parcel` the row's Shipping Rate cell quotes with,
  // so this reads that very query from the cache rather than re-quoting.
  locationId: string | null
  parcel: PackageSelection
  selectedRateId?: string | null
  highValueThreshold: number
}

/**
 * The Alerts column: a warning icon whose tooltip lists every reason the
 * order needs attention. Renders nothing when there are none. The marker
 * attribute lets the table row highlight itself (see `data-table-root`).
 */
export const AlertsCell = ({
  order,
  locationId,
  parcel,
  selectedRateId,
  highValueThreshold,
}: AlertsCellProps) => {
  const { t } = useTranslation()
  // The alert message keys are dynamic, so they can't satisfy the typed `t`.
  const translate = t as (
    key: string,
    options?: Record<string, unknown>
  ) => string
  const { data, isError } = useOrderCarrierRates(order.id, {
    location_id: locationId,
    parcel,
  })

  const quote: OrderAlertQuote = !locationId
    ? { status: "idle" }
    : isError
      ? { status: "error" }
      : data
        ? {
            status: "ok",
            rates: data.rates,
            selectedCarrier:
              data.rates.find((rate) => rate.rate_id === selectedRateId)
                ?.carrier ?? null,
          }
        : { status: "loading" }

  const alerts = computeOrderAlerts({ order, quote, highValueThreshold })

  if (!alerts.length) {
    return null
  }

  return (
    <Tooltip
      content={
        <ul className="flex flex-col gap-y-1">
          {alerts.map((alert) => (
            <li key={alert.code}>
              {translate(alert.messageKey, alert.params)}
            </li>
          ))}
        </ul>
      }
    >
      <span
        data-testid="order-alerts"
        data-row-alert=""
        className="text-ui-fg-warning flex items-center gap-x-1"
      >
        <ExclamationCircleSolid />
        <span className="txt-compact-small-plus">{alerts.length}</span>
      </span>
    </Tooltip>
  )
}
