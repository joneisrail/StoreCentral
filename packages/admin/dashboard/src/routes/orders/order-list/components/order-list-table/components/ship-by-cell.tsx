import { Badge } from "@medusajs/ui"
import { useEffect, useState } from "react"

import { DateCell } from "../../../../../../components/table/table-cells/common/date-cell"

const MINUTE_IN_MS = 60_000
const HOUR_IN_MS = 60 * MINUTE_IN_MS

export type ShipByCellProps = {
  createdAt: string | Date
  handlingHours: number | null | undefined
}

/**
 * Renders the per-order shipping deadline: the order's `created_at` plus
 * its sales channel's configured `handling_hours` SLA (written to
 * `sales_channel.metadata` by the Settings > Fulfillment page - Task 7).
 * Shows the deadline's date (via `DateCell`, so the formatting/tooltip
 * convention matches the `created_at` column elsewhere in this table)
 * alongside either a live countdown ("Xh Ym left", recomputed once a
 * minute) or, once the deadline has passed, a destructive "Overdue" badge.
 *
 * The countdown/"Overdue" state and the "No SLA set" label below are
 * computed, not simple static UI copy, so - matching this file's existing
 * `ShippingRateCell`/`ShipFromCell` convention of rendering computed
 * values directly rather than through `t()` - they're plain strings
 * rather than i18n keys.
 *
 * A sales channel with no `handling_hours` configured at all has no
 * deadline to compute - `handlingHours` is then null/undefined and this
 * renders a muted "No SLA set" label instead of fabricating a deadline.
 */
export const ShipByCell = ({ createdAt, handlingHours }: ShipByCellProps) => {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (handlingHours == null) {
      return
    }

    const interval = setInterval(() => setNow(Date.now()), MINUTE_IN_MS)
    return () => clearInterval(interval)
  }, [handlingHours])

  if (handlingHours == null) {
    return (
      <div className="flex h-full w-full items-center overflow-hidden">
        <span className="truncate text-ui-fg-muted">No SLA set</span>
      </div>
    )
  }

  const deadline = new Date(createdAt).getTime() + handlingHours * HOUR_IN_MS
  const remainingMs = deadline - now
  const isOverdue = remainingMs <= 0

  const hoursLeft = Math.floor(remainingMs / HOUR_IN_MS)
  const minutesLeft = Math.floor((remainingMs % HOUR_IN_MS) / MINUTE_IN_MS)

  return (
    <div className="flex h-full w-full flex-col justify-center gap-y-0.5 overflow-hidden py-1">
      <DateCell date={new Date(deadline)} />
      {isOverdue ? (
        <Badge color="red" size="2xsmall" className="w-fit">
          Overdue
        </Badge>
      ) : (
        <span className="truncate text-ui-fg-subtle">
          {hoursLeft}h {minutesLeft}m left
        </span>
      )}
    </div>
  )
}
