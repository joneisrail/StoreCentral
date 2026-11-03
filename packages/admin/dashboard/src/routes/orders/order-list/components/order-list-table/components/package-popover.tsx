import { Button, Hint, Input, Label, Popover, RadioGroup, Text } from "@medusajs/ui"
import { useId, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  EASYPOST_PACKAGE_PRESETS,
  EasyPostPackagePreset,
} from "../../../../../../lib/easypost-package-presets"
import { formatPackageField, OrderParcel } from "../../../../../../lib/order-parcel"

/**
 * The payload `PackagePopover` hands back to `onChange` once a selection is
 * confirmed: either a carrier preset (`predefinedPackage` + the order's
 * computed weight) or a fully custom parcel. `weight` is always required -
 * for a preset it comes from `initialParcel.weight` (the box's dimensions are
 * fixed by the preset, but EasyPost still needs the actual shipment weight);
 * for Custom it comes from the validated weight input.
 */
export type PackageSelection = {
  predefinedPackage?: string
  weight: number
  length?: number
  width?: number
  height?: number
}

type PackagePopoverProps = {
  /**
   * The parcel computed from the order's own items - what the row ships in
   * until a package is confirmed, and where a preset's weight comes from.
   */
  initialParcel: OrderParcel
  /**
   * The row's currently confirmed package (`ReadyToShipTable`'s
   * `rowPackages[orderId]`), or undefined if none has been confirmed yet.
   * The popover is controlled by this: it holds no confirmed state of its
   * own, so what the trigger shows is always the package the row will
   * actually be quoted and bought with - including after the row remounts
   * (e.g. paging away and back) or the order's items are refetched.
   */
  selection?: PackageSelection
  onChange: (parcel: PackageSelection) => void
}

const CUSTOM_VALUE = "__custom__"

const CARRIERS: EasyPostPackagePreset["carrier"][] = ["USPS", "FedEx"]

const toInputValue = (value: number | null) => (value === null ? "" : String(value))

/**
 * The confirmed parcel to display/reopen with: the confirmed `selection`'s
 * own values (a preset's box dimensions are fixed by the preset, so only its
 * weight applies), or the order's computed `initialParcel` when nothing has
 * been confirmed yet.
 */
const toConfirmedParcel = (
  selection: PackageSelection | undefined,
  initialParcel: OrderParcel
): OrderParcel => {
  if (!selection) {
    return initialParcel
  }

  if (selection.predefinedPackage) {
    return { weight: selection.weight, length: null, width: null, height: null }
  }

  return {
    weight: selection.weight,
    length: selection.length ?? null,
    width: selection.width ?? null,
    height: selection.height ?? null,
  }
}

const parseOptionalNumber = (value: string): number | undefined => {
  if (value.trim() === "") {
    return undefined
  }
  const parsed = Number(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

/**
 * Popover for the Ready to Ship table's Package column. Lets the admin pick
 * a USPS/FedEx `predefined_package` preset, or switch to "Custom" to enter
 * weight and (optional) dimensions directly - the same nullable
 * weight/length/width/height shape `computeOrderParcel` produces.
 *
 * The trigger shows the confirmed `selection` (controlled by the parent): a
 * preset's label, or, for Custom (the default - nothing is preset-selected
 * until the admin picks one), `Custom — LxWxH, weight` using the confirmed
 * custom values, or `initialParcel`'s own values when nothing is confirmed
 * yet, with `formatPackageField`'s "Not set" convention (shared with
 * `PackageCell`) for any missing field. Opening the popover always starts
 * from that confirmed state, so Cancel - or just dismissing it - never leaks
 * in-progress edits into the trigger.
 */
export const PackagePopover = ({
  initialParcel,
  selection,
  onChange,
}: PackagePopoverProps) => {
  const { t } = useTranslation()
  const notSetLabel = t("orders.readyToShip.notSet")

  const weightInputId = useId()
  const lengthInputId = useId()
  const widthInputId = useId()
  const heightInputId = useId()

  const [open, setOpen] = useState(false)

  // The confirmed selection - derived from the `selection` prop on every
  // render (never snapshotted into state), so it can't drift from the
  // package the parent actually quotes and fulfills with. Drives the trigger
  // label and what a newly opened popover resets its in-progress fields to.
  const confirmedPreset = selection?.predefinedPackage ?? CUSTOM_VALUE
  const confirmedParcel = toConfirmedParcel(selection, initialParcel)

  // In-progress fields, only meaningful while the popover is open (reset
  // from the confirmed state above every time it opens).
  const [selectedPreset, setSelectedPreset] = useState<string>(confirmedPreset)
  const [weight, setWeight] = useState(toInputValue(confirmedParcel.weight))
  const [length, setLength] = useState(toInputValue(confirmedParcel.length))
  const [width, setWidth] = useState(toInputValue(confirmedParcel.width))
  const [height, setHeight] = useState(toInputValue(confirmedParcel.height))
  const [weightError, setWeightError] = useState(false)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)

    if (next) {
      setSelectedPreset(confirmedPreset)
      setWeight(toInputValue(confirmedParcel.weight))
      setLength(toInputValue(confirmedParcel.length))
      setWidth(toInputValue(confirmedParcel.width))
      setHeight(toInputValue(confirmedParcel.height))
      setWeightError(false)
    }
  }

  const handleConfirmCustom = () => {
    const weightValue = Number(weight)
    if (weight.trim() === "" || !(weightValue > 0)) {
      setWeightError(true)
      return
    }

    const lengthValue = parseOptionalNumber(length)
    const widthValue = parseOptionalNumber(width)
    const heightValue = parseOptionalNumber(height)

    onChange({
      weight: weightValue,
      length: lengthValue,
      width: widthValue,
      height: heightValue,
    })
    setOpen(false)
  }

  const handleConfirmPreset = (preset: EasyPostPackagePreset) => {
    // The preset fixes the box's own dimensions - only the shipment's
    // weight (from the order's items, same value `PackageCell` shows) still
    // applies, so it's taken from `initialParcel` rather than a visible
    // input. Validated the same way as Custom's weight input (required,
    // > 0): an order with no computed weight at all (every item missing a
    // variant weight) would otherwise silently confirm an unratable
    // `weight: 0` parcel with no in-UI warning. There's no input here to
    // attach the error to directly, so it reuses the same Hint - the fix is
    // for the admin to switch to Custom and enter a weight by hand.
    const weightValue = initialParcel.weight
    if (weightValue === null || !(weightValue > 0)) {
      setWeightError(true)
      return
    }

    setWeightError(false)
    onChange({ predefinedPackage: preset.code, weight: weightValue })
    setOpen(false)
  }

  const handleConfirm = () => {
    if (selectedPreset === CUSTOM_VALUE) {
      handleConfirmCustom()
      return
    }

    const preset = EASYPOST_PACKAGE_PRESETS.find((p) => p.code === selectedPreset)
    if (preset) {
      handleConfirmPreset(preset)
    }
  }

  // Clears a stale weight error from a previous failed confirm whenever the
  // radio selection itself changes - otherwise switching from a failed
  // Custom attempt (or a failed preset attempt) to a different, perfectly
  // confirmable option would still show the old "Weight is required" Hint.
  const handleSelectedPresetChange = (value: string) => {
    setSelectedPreset(value)
    setWeightError(false)
  }

  const confirmedPresetEntry = EASYPOST_PACKAGE_PRESETS.find(
    (p) => p.code === confirmedPreset
  )

  const triggerLabel = confirmedPresetEntry
    ? confirmedPresetEntry.label
    : `Custom — ${formatPackageField(confirmedParcel.length, notSetLabel)}x${formatPackageField(
        confirmedParcel.width,
        notSetLabel
      )}x${formatPackageField(confirmedParcel.height, notSetLabel)}, ${formatPackageField(
        confirmedParcel.weight,
        notSetLabel
      )}`

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {/*
       * Same reasoning as `FulfillConfirmPopover`'s trigger: this cell sits
       * inside `_DataTable`'s row `Link`, so the click must stop here or it
       * bubbles up and navigates to the order detail page instead of
       * opening the popover.
       */}
      <Popover.Trigger asChild>
        <Button
          size="small"
          variant="secondary"
          onClick={(e) => {
            e.stopPropagation()
          }}
        >
          <span className="truncate">{triggerLabel}</span>
        </Button>
      </Popover.Trigger>
      <Popover.Content
        align="end"
        side="top"
        className="w-[360px] overflow-hidden"
        onClick={(e) => {
          e.stopPropagation()
        }}
      >
        <div className="flex max-h-[420px] flex-col gap-y-3 overflow-y-auto p-3">
          {weightError && (
            <Hint variant="error">
              {t("orders.readyToShip.packageWeightRequired")}
            </Hint>
          )}

          <RadioGroup
            value={selectedPreset}
            onValueChange={handleSelectedPresetChange}
            className="flex flex-col gap-y-3"
          >
            {CARRIERS.map((carrier) => (
              <div key={carrier} className="flex flex-col gap-y-1">
                <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
                  {carrier}
                </Text>
                <div className="flex flex-col gap-y-0.5">
                  {EASYPOST_PACKAGE_PRESETS.filter((preset) => preset.carrier === carrier).map(
                    (preset) => (
                      <label
                        key={preset.code}
                        className="hover:bg-ui-bg-base-hover flex cursor-pointer items-center gap-x-2 rounded-md px-1 py-1"
                      >
                        <RadioGroup.Item value={preset.code} />
                        <Text size="small">{preset.label}</Text>
                      </label>
                    )
                  )}
                </div>
              </div>
            ))}

            <label className="hover:bg-ui-bg-base-hover flex cursor-pointer items-center gap-x-2 rounded-md px-1 py-1">
              <RadioGroup.Item value={CUSTOM_VALUE} />
              <Text size="small">{t("orders.readyToShip.packageCustom")}</Text>
            </label>
          </RadioGroup>

          {selectedPreset === CUSTOM_VALUE && (
            <div className="grid grid-cols-2 gap-x-2 gap-y-2">
              <div className="flex flex-col gap-y-1">
                <Label htmlFor={weightInputId} size="xsmall" weight="plus">
                  {t("fields.weight")}
                </Label>
                <Input
                  id={weightInputId}
                  type="number"
                  value={weight}
                  onChange={(e) => {
                    setWeight(e.target.value)
                    setWeightError(false)
                  }}
                />
              </div>
              <div />
              <div className="flex flex-col gap-y-1">
                <Label htmlFor={lengthInputId} size="xsmall">
                  {t("fields.length")}
                </Label>
                <Input
                  id={lengthInputId}
                  type="number"
                  value={length}
                  onChange={(e) => setLength(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-y-1">
                <Label htmlFor={widthInputId} size="xsmall">
                  {t("fields.width")}
                </Label>
                <Input
                  id={widthInputId}
                  type="number"
                  value={width}
                  onChange={(e) => setWidth(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-y-1">
                <Label htmlFor={heightInputId} size="xsmall">
                  {t("fields.height")}
                </Label>
                <Input
                  id={heightInputId}
                  type="number"
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-x-2">
            <Popover.Close asChild>
              <Button size="small" variant="secondary">
                {t("actions.cancel")}
              </Button>
            </Popover.Close>
            <Button size="small" type="button" onClick={handleConfirm}>
              {t("actions.confirm")}
            </Button>
          </div>
        </div>
      </Popover.Content>
    </Popover>
  )
}
