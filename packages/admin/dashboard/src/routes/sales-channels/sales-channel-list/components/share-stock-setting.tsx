import { Container, Heading, Label, Switch, Text, toast } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

import {
  useChannelStockSettings,
  useUpdateChannelStockSettings,
} from "../../../../hooks/api/channel-offers"

/**
 * Store-wide channel stock setting: when on, the remaining stock is split
 * equally across all channels after a sale. Saved on toggle (no optimistic
 * update; the switch is disabled while the request is in flight).
 */
export const ShareStockSetting = () => {
  const { t } = useTranslation()
  const { data, isError } = useChannelStockSettings()
  const { mutateAsync, isPending } = useUpdateChannelStockSettings()
  const checked = data?.share_stock_after_sale ?? false

  const handleChange = async (next: boolean) => {
    try {
      await mutateAsync({ share_stock_after_sale: next })
      toast.success(t("salesChannels.channelStock.saved"))
    } catch (error) {
      toast.error((error as { message?: string } | null)?.message ?? "")
    }
  }

  return (
    <Container className="flex flex-col gap-y-3 px-6 py-4">
      <Heading level="h2">{t("salesChannels.channelStock.title")}</Heading>
      <div className="flex items-center gap-x-3">
        <Switch
          id="share-stock-after-sale"
          checked={checked}
          disabled={isPending}
          onCheckedChange={handleChange}
        />
        <Label htmlFor="share-stock-after-sale" size="small" weight="plus">
          {t("salesChannels.channelStock.shareStock")}
        </Label>
      </div>
      <Text size="small" leading="compact" className="text-ui-fg-subtle">
        {t("salesChannels.channelStock.shareStockHint")}
      </Text>
      {isError ? (
        <Text size="small" leading="compact" className="text-ui-fg-error">
          {t("salesChannels.channelStock.loadError")}
        </Text>
      ) : null}
    </Container>
  )
}
