import { zodResolver } from "@hookform/resolvers/zod"
import {
  Button,
  Heading,
  Input,
  Switch,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import * as zod from "zod"

import { Form } from "../../../../../components/common/form"
import {
  RouteFocusModal,
  useRouteModal,
} from "../../../../../components/modals"
import { KeyboundForm } from "../../../../../components/utilities/keybound-form"
import {
  CreateMarketplaceSalesChannelResponse,
  MarketplaceCredentialKey,
  useCreateMarketplaceSalesChannel,
} from "../../../../../hooks/api/marketplace-connections"
import { useCreateSalesChannel } from "../../../../../hooks/api/sales-channels"
import {
  MarketplacePicker,
  MarketplaceType,
  defaultCredentials,
} from "../../../components/marketplace-fields"

type CredentialFields = Partial<Record<MarketplaceCredentialKey, string>>

const CreateSalesChannelSchema = zod.object({
  name: zod.string().min(1),
  description: zod.string().min(1),
  enabled: zod.boolean(),
})

export const CreateSalesChannelForm = () => {
  const { t } = useTranslation()
  const { handleSuccess } = useRouteModal()

  const form = useForm<zod.infer<typeof CreateSalesChannelSchema>>({
    defaultValues: {
      name: "",
      description: "",
      enabled: true,
    },
    resolver: zodResolver(CreateSalesChannelSchema),
  })
  const { mutateAsync, isPending } = useCreateSalesChannel()
  const {
    mutateAsync: createWithMarketplace,
    isPending: isMarketplacePending,
  } = useCreateMarketplaceSalesChannel()

  const [marketplace, setMarketplace] = useState<MarketplaceType>("none")
  const [credentials, setCredentials] = useState<Record<string, string>>({})

  const handleMarketplaceChange = (next: MarketplaceType) => {
    setMarketplace(next)
    // Never carry credentials over from the previous marketplace.
    setCredentials(defaultCredentials(next))
  }

  const showMarketplaceToast = (
    result: CreateMarketplaceSalesChannelResponse
  ) => {
    switch (result.connection_status) {
      case "connected":
        toast.success(t("salesChannels.marketplace.toast.connected"))
        break
      case "error":
        toast.warning(
          result.message
            ? t("salesChannels.marketplace.toast.error", {
                message: result.message,
              })
            : t("salesChannels.marketplace.toast.errorNoMessage")
        )
        break
      case "unavailable":
        toast.warning(t("salesChannels.marketplace.toast.unavailable"))
        break
      default:
        if (result.input_problem === "missing") {
          toast.info(t("salesChannels.marketplace.toast.missing"))
        } else {
          toast.info(t("salesChannels.marketplace.toast.disconnected"))
        }
    }
  }

  const handleSubmit = form.handleSubmit(async (values) => {
    if (marketplace !== "none") {
      // Empty credential fields are left out; they never block saving.
      const filled = Object.fromEntries(
        Object.entries(credentials).filter(([, value]) => value.trim() !== "")
      ) as CredentialFields
      await createWithMarketplace(
        {
          marketplace,
          name: values.name,
          description: values.description,
          is_disabled: !values.enabled,
          ...filled,
        },
        {
          onSuccess: (result) => {
            showMarketplaceToast(result)
            handleSuccess(`../${result.sales_channel.id}`)
          },
          onError: (error) => toast.error(error.message),
        }
      )
      return
    }

    await mutateAsync(
      {
        name: values.name,
        description: values.description,
        is_disabled: !values.enabled,
      },
      {
        onSuccess: ({ sales_channel }) => {
          toast.success(t("salesChannels.toast.create"))
          handleSuccess(`../${sales_channel.id}`)
        },
        onError: (error) => toast.error(error.message),
      }
    )
  })

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex h-full flex-col overflow-hidden"
      >
        <RouteFocusModal.Header />
        <RouteFocusModal.Body className="flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 flex-col items-center overflow-y-auto">
            <div className="flex w-full max-w-[720px] flex-col gap-y-8 px-2 py-16">
              <div>
                <Heading className="capitalize">
                  {t("salesChannels.createSalesChannel")}
                </Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  {t("salesChannels.createSalesChannelHint")}
                </Text>
              </div>
              <MarketplacePicker
                value={marketplace}
                onChange={handleMarketplaceChange}
                values={credentials}
                onValueChange={(name, value) =>
                  setCredentials((prev) => ({ ...prev, [name]: value }))
                }
              />
              <div className="flex flex-col gap-y-4">
                <div className="grid grid-cols-2">
                  <Form.Field
                    control={form.control}
                    name="name"
                    render={({ field }) => {
                      return (
                        <Form.Item>
                          <Form.Label>{t("fields.name")}</Form.Label>
                          <Form.Control>
                            <Input size="small" {...field} />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )
                    }}
                  />
                </div>
                <Form.Field
                  control={form.control}
                  name="description"
                  render={({ field }) => {
                    return (
                      <Form.Item>
                        <Form.Label>{t("fields.description")}</Form.Label>
                        <Form.Control>
                          <Textarea {...field} />
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )
                  }}
                />
              </div>
              <Form.Field
                control={form.control}
                name="enabled"
                render={({ field: { value, onChange, ...field } }) => {
                  return (
                    <Form.Item>
                      <div className="flex items-center justify-between">
                        <Form.Label>{t("general.enabled")}</Form.Label>
                        <Form.Control>
                          <Switch
                            dir="ltr"
                            className="rtl:rotate-180"
                            {...field}
                            checked={value}
                            onCheckedChange={onChange}
                          />
                        </Form.Control>
                      </div>
                      <Form.Hint>{t("salesChannels.enabledHint")}</Form.Hint>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )
                }}
              />
            </div>
          </div>
        </RouteFocusModal.Body>
        <RouteFocusModal.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteFocusModal.Close asChild>
              <Button size="small" variant="secondary">
                {t("actions.cancel")}
              </Button>
            </RouteFocusModal.Close>
            <Button
              size="small"
              type="submit"
              isLoading={isPending || isMarketplacePending}
            >
              {t("actions.save")}
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}
