import { Switch } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

import { RowLinkGuard } from "./row-link-guard"

type EmailToggleProps = {
  orderId: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

/**
 * Whether the customer is emailed when this order is fulfilled. On by
 * default; off sends `no_notification: true` for that order.
 */
export const EmailToggle = ({
  orderId,
  checked,
  onCheckedChange,
}: EmailToggleProps) => {
  const { t } = useTranslation()

  return (
    <RowLinkGuard>
      <Switch
        size="small"
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={`${t("orders.readyToShip.emailToggle")} - ${orderId}`}
      />
    </RowLinkGuard>
  )
}
