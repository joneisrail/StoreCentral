import { Badge } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

import { getBrowserTimeZone, getOrderDueStatus } from "../../due-status"

const COLORS = {
  overdue: "red",
  today: "orange",
  tomorrow: "blue",
  days: "grey",
} as const

type DueBadgeProps = {
  createdAt: string | Date
  handlingHours: number | null | undefined
  now?: Date
  timeZone?: string
}

/**
 * How soon the order must ship by: Overdue / Due today / Due tomorrow /
 * Due in N days. Renders nothing when handling hours are not configured.
 */
export const DueBadge = ({
  createdAt,
  handlingHours,
  now,
  timeZone,
}: DueBadgeProps) => {
  const { t } = useTranslation()
  const status = getOrderDueStatus(
    createdAt,
    handlingHours,
    now ?? new Date(),
    timeZone ?? getBrowserTimeZone()
  )

  if (!status) {
    return null
  }

  return (
    <div className="flex h-full w-full items-center overflow-hidden">
      <Badge color={COLORS[status.kind]} size="2xsmall" className="w-fit">
        {status.kind === "days"
          ? t("orders.readyToShip.due.days", { days: status.days })
          : t(`orders.readyToShip.due.${status.kind}`)}
      </Badge>
    </div>
  )
}
