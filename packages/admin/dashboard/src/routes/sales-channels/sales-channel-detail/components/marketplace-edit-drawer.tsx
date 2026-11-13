import { Button, Drawer, Text, toast } from "@medusajs/ui"
import { FormEvent, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  MarketplaceConnection,
  SaveMarketplaceConnectionInput,
  useSaveMarketplaceConnection,
} from "../../../../hooks/api/marketplace-connections"
import {
  MARKETPLACES,
  MarketplaceFields,
} from "../../components/marketplace-fields"

type MarketplaceEditDrawerProps = {
  connection: MarketplaceConnection
  open: boolean
  onOpenChange: (open: boolean) => void
}

const initialValues = (connection: MarketplaceConnection) => {
  const values: Record<string, string> = {}
  for (const field of MARKETPLACES[connection.marketplace].fields) {
    const stored = connection.fields?.[field.name]
    // Secrets are never prefilled.
    values[field.name] =
      !field.secret && typeof stored === "string" ? stored : ""
  }
  return values
}

// Edits the credentials of an existing connection. Only fields the user typed
// are sent, so a blank secret keeps the stored value.
export const MarketplaceEditDrawer = ({
  connection,
  open,
  onOpenChange,
}: MarketplaceEditDrawerProps) => {
  const { t } = useTranslation()
  const { mutateAsync, isPending } = useSaveMarketplaceConnection(connection.id)
  const [initial] = useState(() => initialValues(connection))
  const [values, setValues] = useState<Record<string, string>>(initial)
  const [failure, setFailure] = useState<string | null>(null)

  const fields = MARKETPLACES[connection.marketplace].fields.map((field) => {
    if (!field.secret) {
      return field
    }
    return connection.credentials_source === "database"
      ? { ...field, help: t("salesChannels.marketplace.stored") }
      : field
  })

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setFailure(null)

    const payload = Object.fromEntries(
      Object.entries(values).filter(
        ([name, value]) => value.trim() !== "" && value !== initial[name]
      )
    ) as SaveMarketplaceConnectionInput

    try {
      const result = await mutateAsync(payload)
      if (result?.test && !result.test.ok) {
        toast.warning(
          t("salesChannels.marketplace.toast.saveTestFailed", {
            message: result.test.message ?? "",
          })
        )
      } else if (result?.ok === false) {
        // Credentials were saved and tested, but the connection did not start.
        const detail =
          typeof result.message === "string"
            ? result.message
            : typeof result.error === "string"
              ? result.error
              : ""
        toast.warning(
          t("salesChannels.marketplace.toast.saveApplyFailed", {
            message: detail,
          })
        )
      } else {
        toast.success(t("salesChannels.marketplace.toast.saved"))
      }
      onOpenChange(false)
    } catch (error) {
      const err = error as { status?: number; message?: string }
      if (err?.status === 422) {
        setFailure(err.message ?? "")
      } else {
        toast.error(err?.message ?? "")
      }
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <Drawer.Content>
        <form onSubmit={handleSubmit} className="flex h-full flex-col">
          <Drawer.Header>
            <Drawer.Title>
              {t("salesChannels.marketplace.editTitle")}
            </Drawer.Title>
          </Drawer.Header>
          <Drawer.Body className="flex flex-1 flex-col gap-y-4 overflow-y-auto">
            <Text size="small" className="text-ui-fg-subtle">
              {t("salesChannels.marketplace.editHint")}
            </Text>
            {failure !== null ? (
              <div role="alert" className="flex flex-col gap-y-1">
                <Text size="small" className="text-ui-fg-error">
                  {failure}
                </Text>
                {connection.status === "connected" ? (
                  <Text size="small" className="text-ui-fg-subtle">
                    {t("salesChannels.marketplace.testFailedUnchanged")}
                  </Text>
                ) : null}
              </div>
            ) : null}
            <MarketplaceFields
              fields={fields}
              values={values}
              idPrefix="marketplace-edit"
              onChange={(name, value) =>
                setValues((prev) => ({ ...prev, [name]: value }))
              }
            />
          </Drawer.Body>
          <Drawer.Footer>
            <Drawer.Close asChild>
              <Button size="small" variant="secondary" type="button">
                {t("actions.cancel")}
              </Button>
            </Drawer.Close>
            <Button size="small" type="submit" isLoading={isPending}>
              {t("actions.save")}
            </Button>
          </Drawer.Footer>
        </form>
      </Drawer.Content>
    </Drawer>
  )
}
