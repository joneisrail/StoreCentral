import { Badge } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { DateCell } from "../../../../../../components/table/table-cells/common/date-cell"

const MINUTE_IN_MS = 60_000
const HOUR_IN_MS = 60 * MINUTE_IN_MS

export type ShipByProps = {
  createdAt: string | Date
  handlingHours: number | null | undefined
}

/**
 * Computes the per-order shipping deadline - the order's `created_at`
 * plus its sales channel's configured `handling_hours` SLA (written to
 * `sales_channel.metadata` by the Settings > Fulfillment page - Task 7).
 * Returns `null` when no SLA is configured at all (`handlingHours` is
 * null/undefined) rather than fabricating one.
 *
 * The single source of truth both `ShipDateCell` and `ShipTimeCell`
 * below derive their rendering from, so the Ship Date and Ship Time
 * columns can never compute a different deadline from each other.
 */
export const computeShipDeadline = (
  createdAt: string | Date,
  handlingHours: number | null | undefined
): number | null =>
  handlingHours == null
    ? null
    : new Date(createdAt).getTime() + handlingHours * HOUR_IN_MS

/**
 * The state both `ShipDateCell` and `ShipTimeCell` render when there's no
 * deadline to compute from (`computeShipDeadline` returned `null`) - a
 * sales channel with no `handling_hours` configured at all.
 */
const NoSlaSetCell = () => {
  const { t } = useTranslation()

  return (
    <div className="flex h-full w-full items-center overflow-hidden">
      <span className="truncate text-ui-fg-muted">
        {t("orders.readyToShip.noSlaSet")}
      </span>
    </div>
  )
}

/**
 * Renders the Ship Date column: the computed deadline's date, via the
 * same `DateCell` the `created_at` column already uses elsewhere in this
 * table (so formatting and the hover tooltip stay consistent), or the
 * shared "No SLA set" state when there's no deadline to compute at all.
 */
export const ShipDateCell = ({ createdAt, handlingHours }: ShipByProps) => {
  const deadline = computeShipDeadline(createdAt, handlingHours)

  if (deadline == null) {
    return <NoSlaSetCell />
  }

  return <DateCell date={new Date(deadline)} />
}

/**
 * Renders the Ship Time column: a live countdown to the same deadline
 * `ShipDateCell` renders the date of ("Xh Ym left", recomputed once a
 * minute via a `setInterval` that only runs while there's a deadline to
 * count down to), a destructive "Overdue" badge once that deadline has
 * passed, or the shared "No SLA set" state.
 */
export const ShipTimeCell = ({ createdAt, handlingHours }: ShipByProps) => {
  const { t } = useTranslation()
  const deadline = computeShipDeadline(createdAt, handlingHours)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (deadline == null) {
      return
    }

    const interval = setInterval(() => setNow(Date.now()), MINUTE_IN_MS)
    return () => clearInterval(interval)
  }, [deadline])

  if (deadline == null) {
    return <NoSlaSetCell />
  }

  const remainingMs = deadline - now

  if (remainingMs <= 0) {
    return (
      <div className="flex h-full w-full items-center overflow-hidden">
        <Badge color="red" size="2xsmall" className="w-fit">
          {t("orders.readyToShip.overdue")}
        </Badge>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full items-center overflow-hidden">
      <span className="truncate">
        {t("orders.readyToShip.timeLeft", {
          hours: Math.floor(remainingMs / HOUR_IN_MS),
          minutes: Math.floor((remainingMs % HOUR_IN_MS) / MINUTE_IN_MS),
        })}
      </span>
    </div>
  )
}
