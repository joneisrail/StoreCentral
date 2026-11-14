import { ExclamationCircleSolid } from "@medusajs/icons"
import { clx } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

type OverdueBannerProps = {
  count: number
  active: boolean
  onToggle: () => void
}

/**
 * Shown above the Ready to Ship table when rows of the loaded page are past
 * their ship-by deadline; clicking toggles an "overdue only" filter.
 */
export const OverdueBanner = ({
  count,
  active,
  onToggle,
}: OverdueBannerProps) => {
  const { t } = useTranslation()

  if (count <= 0) {
    return null
  }

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      className={clx(
        "txt-compact-small-plus flex w-full items-center gap-x-2 border-b px-6 py-3 text-left text-ui-fg-base",
        active
          ? "bg-ui-tag-red-bg"
          : "bg-ui-bg-subtle hover:bg-ui-bg-subtle-hover"
      )}
    >
      <ExclamationCircleSolid className="text-ui-fg-error" />
      <span>{t("orders.readyToShip.overdueBanner", { count })}</span>
      <span className="txt-compact-small ms-auto text-ui-fg-subtle">
        {active
          ? t("orders.readyToShip.overdueShowAll")
          : t("orders.readyToShip.overdueShowOnly")}
      </span>
    </button>
  )
}
