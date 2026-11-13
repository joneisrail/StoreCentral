import { Label, RadioGroup, Text } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

import { MarketplaceFields } from "./marketplace-fields"
import { MARKETPLACE_KEYS, MARKETPLACES, MarketplaceType } from "./registry"

type MarketplacePickerProps = {
  value: MarketplaceType
  onChange: (value: MarketplaceType) => void
  values: Record<string, string>
  onValueChange: (name: string, value: string) => void
}

export const MarketplacePicker = ({
  value,
  onChange,
  values,
  onValueChange,
}: MarketplacePickerProps) => {
  const { t } = useTranslation()
  const options: { key: MarketplaceType; label: string }[] = [
    { key: "none", label: t("salesChannels.marketplace.none") },
    ...MARKETPLACE_KEYS.map((key) => ({ key, label: MARKETPLACES[key].label })),
  ]
  const selected = value === "none" ? undefined : MARKETPLACES[value]

  return (
    <div className="flex flex-col gap-y-4">
      <div>
        <Label size="small" weight="plus">
          {t("salesChannels.marketplace.title")}
        </Label>
        <Text size="small" className="text-ui-fg-subtle">
          {t("salesChannels.marketplace.hint")}
        </Text>
      </div>
      <RadioGroup
        className="grid grid-cols-2 gap-2 md:grid-cols-4"
        value={value}
        onValueChange={(next) => onChange(next as MarketplaceType)}
      >
        {options.map((option) => (
          <div
            key={option.key}
            className="flex items-center gap-x-2 rounded-md bg-ui-bg-component px-3 py-2 shadow-borders-base"
          >
            <RadioGroup.Item
              value={option.key}
              id={`marketplace-${option.key}`}
            />
            <Label htmlFor={`marketplace-${option.key}`} size="small">
              {option.label}
            </Label>
          </div>
        ))}
      </RadioGroup>
      {selected ? (
        <div className="flex flex-col gap-y-4">
          {!selected.syncLive ? (
            <Text size="small" className="text-ui-fg-subtle">
              {t("salesChannels.marketplace.syncNotLive")}
            </Text>
          ) : null}
          <Text size="small" className="text-ui-fg-subtle">
            {t("salesChannels.marketplace.credentialsHint")}
          </Text>
          <MarketplaceFields
            fields={selected.fields}
            values={values}
            onChange={onValueChange}
          />
        </div>
      ) : null}
    </div>
  )
}
