import { Input, Label, Text } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

import { FieldDef } from "./registry"

type MarketplaceFieldsProps = {
  fields: FieldDef[]
  values: Record<string, string>
  onChange: (name: string, value: string) => void
  idPrefix?: string
}

// Renders any registry field list. Secret fields are password inputs and are
// never prefilled by this component.
export const MarketplaceFields = ({
  fields,
  values,
  onChange,
  idPrefix = "marketplace",
}: MarketplaceFieldsProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-y-4">
      {fields.map((field) => {
        const id = `${idPrefix}-${field.name}`
        return (
          <div key={field.name} className="flex flex-col gap-y-1">
            <Label htmlFor={id} size="small" weight="plus">
              {field.label}
              {field.required ? null : (
                <span className="font-normal text-ui-fg-muted">
                  {" "}
                  ({t("fields.optional")})
                </span>
              )}
            </Label>
            <Input
              id={id}
              size="small"
              name={field.name}
              type={field.secret ? "password" : "text"}
              autoComplete="off"
              placeholder={field.placeholder}
              value={values[field.name] ?? ""}
              onChange={(e) => onChange(field.name, e.target.value)}
            />
            {field.help ? (
              <Text size="small" className="text-ui-fg-subtle">
                {field.help}
              </Text>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
