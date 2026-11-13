import { Button, Drawer, toast } from "@medusajs/ui"
import { FormEvent, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  CreateMarketplaceSalesChannelResponse,
  MarketplaceCredentialKey,
  useCreateMarketplaceSalesChannel,
} from "../../../../hooks/api/marketplace-connections"
import {
  MarketplacePicker,
  MarketplaceType,
  defaultCredentials,
} from "../../components/marketplace-fields"

type MarketplaceConnectDrawerProps = {
  salesChannelId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Attaches a new marketplace connection to this existing sales channel.
export const MarketplaceConnectDrawer = ({
  salesChannelId,
  open,
  onOpenChange,
}: MarketplaceConnectDrawerProps) => {
  const { t } = useTranslation()
  const { mutateAsync, isPending } = useCreateMarketplaceSalesChannel()
  const [marketplace, setMarketplace] = useState<MarketplaceType>("none")
  const [credentials, setCredentials] = useState<Record<string, string>>({})

  const showToast = (result: CreateMarketplaceSalesChannelResponse) => {
    const message = result.message ?? ""
    switch (result.connection_status) {
      case "connected":
        toast.success(t("salesChannels.marketplace.toast.attached"))
        break
      case "error":
        toast.warning(
          t("salesChannels.marketplace.toast.attachError", { message })
        )
        break
      case "unavailable":
        toast.warning(t("salesChannels.marketplace.toast.attachUnavailable"))
        break
      default:
        toast.info(t("salesChannels.marketplace.toast.attachDisconnected"))
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (marketplace === "none") {
      return
    }
    const filled = Object.fromEntries(
      Object.entries(credentials).filter(([, value]) => value.trim() !== "")
    ) as Partial<Record<MarketplaceCredentialKey, string>>

    try {
      const result = await mutateAsync({
        marketplace,
        sales_channel_id: salesChannelId,
        ...filled,
      })
      showToast(result)
      onOpenChange(false)
    } catch (error) {
      toast.error((error as { message?: string })?.message ?? "")
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <Drawer.Content>
        <form onSubmit={handleSubmit} className="flex h-full flex-col">
          <Drawer.Header>
            <Drawer.Title>
              {t("salesChannels.marketplace.connectTitle")}
            </Drawer.Title>
          </Drawer.Header>
          <Drawer.Body className="flex-1 overflow-y-auto">
            <MarketplacePicker
              value={marketplace}
              onChange={(next) => {
                setMarketplace(next)
                setCredentials(defaultCredentials(next))
              }}
              values={credentials}
              onValueChange={(name, value) =>
                setCredentials((prev) => ({ ...prev, [name]: value }))
              }
            />
          </Drawer.Body>
          <Drawer.Footer>
            <Drawer.Close asChild>
              <Button size="small" variant="secondary" type="button">
                {t("actions.cancel")}
              </Button>
            </Drawer.Close>
            <Button
              size="small"
              type="submit"
              isLoading={isPending}
              disabled={marketplace === "none"}
            >
              {t("actions.save")}
            </Button>
          </Drawer.Footer>
        </form>
      </Drawer.Content>
    </Drawer>
  )
}
