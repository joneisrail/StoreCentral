import { Label, Switch, Text, toast } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

import { useSaveMarketplaceConnection } from "../../../../../hooks/api/marketplace-connections"

type AutoSyncPriceSwitchProps = {
  connectionId: string
  /** The connection's `auto_sync_price`; absent means off. */
  checked?: boolean
  disabled?: boolean
}

/**
 * Per-connection "auto-sync prices" switch. Writes `auto_sync_price` through
 * the existing connection update route. The backend field/column lands in
 * Task 14; this is written against that contract.
 */
export const AutoSyncPriceSwitch = ({
  connectionId,
  checked = false,
  disabled = false,
}: AutoSyncPriceSwitchProps) => {
  const { t } = useTranslation()
  const { mutateAsync, isPending } = useSaveMarketplaceConnection(connectionId)

  const handleChange = async (next: boolean) => {
    try {
      await mutateAsync({ auto_sync_price: next })
      toast.success(t("salesChannels.marketplace.toast.autoSyncPriceSaved"))
    } catch (error) {
      toast.error((error as { message?: string } | null)?.message ?? "")
    }
  }

  return (
    <div className="flex flex-col gap-y-1 px-6 py-4">
      <div className="flex items-center gap-x-3">
        <Switch
          id={`auto-sync-price-${connectionId}`}
          checked={checked}
          disabled={disabled || isPending}
          onCheckedChange={handleChange}
        />
        <Label
          htmlFor={`auto-sync-price-${connectionId}`}
          size="small"
          weight="plus"
        >
          {t("salesChannels.marketplace.autoSyncPrice")}
        </Label>
      </div>
      <Text size="small" leading="compact" className="text-ui-fg-subtle">
        {t("salesChannels.marketplace.autoSyncPriceHint")}
      </Text>
    </div>
  )
}
