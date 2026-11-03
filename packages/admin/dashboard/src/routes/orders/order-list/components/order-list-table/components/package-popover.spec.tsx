// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

// Identity passthrough, matching the convention already used by
// `fulfill-confirm-popover.spec.tsx`/`ready-to-ship-table.spec.tsx`: every
// translated piece of UI text is asserted on by its raw i18n key rather than
// a human-readable string, since this package has no real i18n instance
// wired up for tests. Carrier names ("USPS"/"FedEx") and preset labels come
// straight from `EASYPOST_PACKAGE_PRESETS` data, not through `t()`, so they
// render as literal English regardless of this mock.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

import { useState } from "react"

import { PackagePopover, PackageSelection } from "./package-popover"

const parcel = { weight: 10, length: 5, width: 4, height: 3 }

// `PackagePopover` is controlled by its `selection` prop - this harness plays
// the parent (`ReadyToShipTable`'s `rowPackages`) for tests that confirm a
// selection and then look at the trigger.
const ControlledPackagePopover = ({
  initialParcel = parcel,
}: {
  initialParcel?: typeof parcel
}) => {
  const [selection, setSelection] = useState<PackageSelection | undefined>()
  return (
    <PackagePopover
      initialParcel={initialParcel}
      selection={selection}
      onChange={setSelection}
    />
  )
}

afterEach(() => {
  cleanup()
})

describe("PackagePopover", () => {
  it("lists USPS and FedEx presets grouped by carrier", () => {
    render(<PackagePopover initialParcel={parcel} onChange={vi.fn()} />)

    fireEvent.click(screen.getByRole("button"))

    expect(screen.getByText("USPS")).toBeTruthy()
    expect(screen.getByText("FedEx")).toBeTruthy()
    // Spot check a preset from each carrier is actually listed, not just the
    // group heading.
    expect(
      screen.getByText("USPS Small Flat Rate Box (8.6875in x 5.4375in x 1.75in)")
    ).toBeTruthy()
    expect(
      screen.getByText("FedEx Small Box (12.25in x 10.9in x 1.5in)")
    ).toBeTruthy()
  })

  it("calls onChange with the predefined_package code and the order's computed weight when a preset is confirmed", () => {
    const onChange = vi.fn()
    render(<PackagePopover initialParcel={parcel} onChange={onChange} />)

    fireEvent.click(screen.getByRole("button"))
    fireEvent.click(
      screen.getByText("USPS Small Flat Rate Box (8.6875in x 5.4375in x 1.75in)")
    )
    fireEvent.click(screen.getByRole("button", { name: "actions.confirm" }))

    expect(onChange).toHaveBeenCalledWith({
      predefinedPackage: "SmallFlatRateBox",
      weight: 10,
    })
  })

  it("closes the popover and updates the trigger to the preset's label once confirmed", () => {
    render(<ControlledPackagePopover />)

    fireEvent.click(screen.getByRole("button"))
    fireEvent.click(
      screen.getByText("USPS Small Flat Rate Box (8.6875in x 5.4375in x 1.75in)")
    )
    fireEvent.click(screen.getByRole("button", { name: "actions.confirm" }))

    expect(
      screen.getByText("USPS Small Flat Rate Box (8.6875in x 5.4375in x 1.75in)")
    ).toBeTruthy()
    // The popover content (Confirm/Cancel buttons) is gone - only the
    // trigger button remains.
    expect(screen.queryByRole("button", { name: "actions.confirm" })).toBeNull()
  })

  it("blocks confirming a custom package with empty or zero weight, and never calls onChange", () => {
    const onChange = vi.fn()
    render(<PackagePopover initialParcel={parcel} onChange={onChange} />)

    fireEvent.click(screen.getByRole("button"))
    fireEvent.click(screen.getByText("orders.readyToShip.packageCustom"))
    fireEvent.change(screen.getByLabelText("fields.weight"), {
      target: { value: "0" },
    })
    fireEvent.click(screen.getByRole("button", { name: "actions.confirm" }))

    expect(
      screen.getByText("orders.readyToShip.packageWeightRequired")
    ).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
  })

  it("defaults the custom inputs to the initial parcel's own values, and calls onChange with any edits merged in", () => {
    const onChange = vi.fn()
    render(<PackagePopover initialParcel={parcel} onChange={onChange} />)

    fireEvent.click(screen.getByRole("button"))
    // Custom is already the default selection (nothing preset-selected yet),
    // so the four inputs - pre-filled from `initialParcel` - are visible
    // without clicking "Custom" first.
    fireEvent.change(screen.getByLabelText("fields.weight"), {
      target: { value: "12" },
    })
    fireEvent.change(screen.getByLabelText("fields.length"), {
      target: { value: "7" },
    })
    fireEvent.click(screen.getByRole("button", { name: "actions.confirm" }))

    // width/height were never touched, so they pass through unchanged from
    // `initialParcel` (4 and 3) rather than being blanked out.
    expect(onChange).toHaveBeenCalledWith({
      weight: 12,
      length: 7,
      width: 4,
      height: 3,
    })
  })

  it("hides the four custom number inputs once a preset is selected, and reveals them again when switching back to Custom", () => {
    render(<PackagePopover initialParcel={parcel} onChange={vi.fn()} />)

    fireEvent.click(screen.getByRole("button"))

    // Custom is the default selection, so the inputs start out visible.
    expect(screen.getByLabelText("fields.weight")).toBeTruthy()

    fireEvent.click(
      screen.getByText("USPS Small Flat Rate Box (8.6875in x 5.4375in x 1.75in)")
    )

    expect(screen.queryByLabelText("fields.weight")).toBeNull()
    expect(screen.queryByLabelText("fields.length")).toBeNull()
    expect(screen.queryByLabelText("fields.width")).toBeNull()
    expect(screen.queryByLabelText("fields.height")).toBeNull()

    fireEvent.click(screen.getByText("orders.readyToShip.packageCustom"))

    expect(screen.getByLabelText("fields.weight")).toBeTruthy()
    expect(screen.getByLabelText("fields.length")).toBeTruthy()
    expect(screen.getByLabelText("fields.width")).toBeTruthy()
    expect(screen.getByLabelText("fields.height")).toBeTruthy()
  })

  it("blocks confirming a preset when the order's computed parcel has no weight at all, and never calls onChange", () => {
    const onChange = vi.fn()
    render(
      <PackagePopover
        initialParcel={{ weight: null, length: null, width: null, height: null }}
        onChange={onChange}
      />
    )

    fireEvent.click(screen.getByRole("button"))
    fireEvent.click(
      screen.getByText("USPS Small Flat Rate Box (8.6875in x 5.4375in x 1.75in)")
    )
    fireEvent.click(screen.getByRole("button", { name: "actions.confirm" }))

    expect(
      screen.getByText("orders.readyToShip.packageWeightRequired")
    ).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
    // Still open, trigger unchanged - a blocked preset confirm must not
    // silently close as if it had succeeded.
    expect(screen.getByRole("button", { name: "actions.confirm" })).toBeTruthy()
  })

  it("blocks confirming a preset when the order's computed weight is exactly 0, and never calls onChange", () => {
    const onChange = vi.fn()
    render(
      <PackagePopover
        initialParcel={{ weight: 0, length: null, width: null, height: null }}
        onChange={onChange}
      />
    )

    fireEvent.click(screen.getByRole("button"))
    fireEvent.click(
      screen.getByText("FedEx Small Box (12.25in x 10.9in x 1.5in)")
    )
    fireEvent.click(screen.getByRole("button", { name: "actions.confirm" }))

    expect(
      screen.getByText("orders.readyToShip.packageWeightRequired")
    ).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
  })

  it("clears a stale weight-required error from a failed Custom confirm once a different, confirmable selection is made", () => {
    const onChange = vi.fn()
    render(<PackagePopover initialParcel={parcel} onChange={onChange} />)

    fireEvent.click(screen.getByRole("button"))
    // Custom is the default - force a failed confirm first.
    fireEvent.change(screen.getByLabelText("fields.weight"), {
      target: { value: "0" },
    })
    fireEvent.click(screen.getByRole("button", { name: "actions.confirm" }))
    expect(
      screen.getByText("orders.readyToShip.packageWeightRequired")
    ).toBeTruthy()

    // Switching to a preset (the order's own computed weight, 10, is valid)
    // must drop the stale error rather than leaving it stuck on screen.
    fireEvent.click(
      screen.getByText("USPS Small Flat Rate Box (8.6875in x 5.4375in x 1.75in)")
    )
    expect(
      screen.queryByText("orders.readyToShip.packageWeightRequired")
    ).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "actions.confirm" }))
    expect(onChange).toHaveBeenCalledWith({
      predefinedPackage: "SmallFlatRateBox",
      weight: 10,
    })
  })

  it("shows 'Custom - L x W x H, weight' using the initial parcel when nothing has been confirmed yet, with 'Not set' for any missing field", () => {
    render(
      <PackagePopover
        initialParcel={{ weight: null, length: null, width: null, height: null }}
        onChange={vi.fn()}
      />
    )

    expect(
      screen.getByText(
        "Custom — orders.readyToShip.notSetxorders.readyToShip.notSetxorders.readyToShip.notSet, orders.readyToShip.notSet"
      )
    ).toBeTruthy()
  })

  describe("controlled by the confirmed selection", () => {
    it("shows an already-confirmed preset on a fresh mount (e.g. after paging away and back), not the computed default", () => {
      render(
        <PackagePopover
          initialParcel={parcel}
          selection={{ predefinedPackage: "SmallFlatRateBox", weight: 10 }}
          onChange={vi.fn()}
        />
      )

      expect(
        screen.getByText("USPS Small Flat Rate Box (8.6875in x 5.4375in x 1.75in)")
      ).toBeTruthy()
      expect(screen.queryByText(/^Custom — /)).toBeNull()
    })

    it("shows an already-confirmed custom package on a fresh mount, and reopens with its values", () => {
      render(
        <PackagePopover
          initialParcel={parcel}
          selection={{ weight: 22, length: 9, width: 8, height: 7 }}
          onChange={vi.fn()}
        />
      )

      expect(screen.getByText("Custom — 9x8x7, 22")).toBeTruthy()

      fireEvent.click(screen.getByRole("button"))
      expect(
        (screen.getByLabelText("fields.weight") as HTMLInputElement).value
      ).toBe("22")
      expect(
        (screen.getByLabelText("fields.length") as HTMLInputElement).value
      ).toBe("9")
    })

    it("follows the selection prop when the parent changes it, rather than a snapshot taken at mount", () => {
      const { rerender } = render(
        <PackagePopover initialParcel={parcel} onChange={vi.fn()} />
      )
      expect(screen.getByText("Custom — 5x4x3, 10")).toBeTruthy()

      rerender(
        <PackagePopover
          initialParcel={parcel}
          selection={{ predefinedPackage: "SmallFlatRateBox", weight: 10 }}
          onChange={vi.fn()}
        />
      )
      expect(
        screen.getByText("USPS Small Flat Rate Box (8.6875in x 5.4375in x 1.75in)")
      ).toBeTruthy()
    })

    it("follows a changed computed parcel (e.g. items refetched) while nothing is confirmed yet", () => {
      const { rerender } = render(
        <PackagePopover initialParcel={parcel} onChange={vi.fn()} />
      )
      expect(screen.getByText("Custom — 5x4x3, 10")).toBeTruthy()

      rerender(
        <PackagePopover
          initialParcel={{ weight: 30, length: 6, width: 5, height: 4 }}
          onChange={vi.fn()}
        />
      )
      expect(screen.getByText("Custom — 6x5x4, 30")).toBeTruthy()

      fireEvent.click(screen.getByRole("button"))
      expect(
        (screen.getByLabelText("fields.weight") as HTMLInputElement).value
      ).toBe("30")
    })

    it("does not change the trigger on its own when the parent ignores onChange", () => {
      const onChange = vi.fn()
      render(<PackagePopover initialParcel={parcel} onChange={onChange} />)

      fireEvent.click(screen.getByRole("button"))
      fireEvent.click(
        screen.getByText("USPS Small Flat Rate Box (8.6875in x 5.4375in x 1.75in)")
      )
      fireEvent.click(screen.getByRole("button", { name: "actions.confirm" }))

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(screen.getByText("Custom — 5x4x3, 10")).toBeTruthy()
    })
  })
})
