// @vitest-environment jsdom
import { TooltipProvider } from "@medusajs/ui"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

// Mirrors the real `en.json` strings for the keys this file's components
// use, so assertions can check human-readable text rather than raw i18n
// keys - unlike the identity-passthrough mock other specs in this
// directory use for purely static labels, `noSlaSet`/`overdue` contain
// spaces the identity mock can't reproduce, and `timeLeft` needs real
// interpolation of its `{{hours}}`/`{{minutes}}` placeholders. `i18n` is
// also provided because `use-date.tsx` (behind `DateCell`, rendered by
// `ShipDateCell`) reads `i18n.language` directly, not just `t`.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === "orders.readyToShip.timeLeft" && options) {
        return `${options.hours}h ${options.minutes}m left`
      }

      const translations: Record<string, string> = {
        "orders.readyToShip.noSlaSet": "No SLA set",
        "orders.readyToShip.overdue": "Overdue",
      }

      return translations[key] ?? key
    },
    i18n: { language: "en" },
  }),
}))

import { ShipDateCell, ShipTimeCell } from "./ship-by-cell"

afterEach(() => {
  cleanup()
})

describe("ShipDateCell", () => {
  it("renders the computed deadline's date when an SLA is configured", () => {
    const createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() // 2h ago

    render(
      <TooltipProvider>
        <ShipDateCell createdAt={createdAt} handlingHours={24} />
      </TooltipProvider>
    )

    // `DateCell` renders the deadline (createdAt + 24h) as a formatted
    // date, e.g. "Nov 2, 2026" - assert a 4-digit year rendered, and that
    // the no-SLA state (the only other thing this component can render)
    // did not.
    expect(screen.getByText(/\d{4}/)).toBeTruthy()
    expect(screen.queryByText(/no sla set/i)).toBeNull()
  })

  it("renders the defined no-SLA state when the sales channel has no handling_hours configured", () => {
    render(
      <TooltipProvider>
        <ShipDateCell createdAt={new Date().toISOString()} handlingHours={null} />
      </TooltipProvider>
    )

    expect(screen.getByText(/no sla set/i)).toBeTruthy()
  })

  it("renders the same no-SLA state when handlingHours is undefined", () => {
    render(
      <TooltipProvider>
        <ShipDateCell
          createdAt={new Date().toISOString()}
          handlingHours={undefined}
        />
      </TooltipProvider>
    )

    expect(screen.getByText(/no sla set/i)).toBeTruthy()
  })
})

describe("ShipTimeCell", () => {
  it("renders a live countdown when not yet overdue", () => {
    const createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() // 2h ago

    render(
      <TooltipProvider>
        <ShipTimeCell createdAt={createdAt} handlingHours={24} />
      </TooltipProvider>
    )

    expect(screen.getByText(/left/i)).toBeTruthy() // e.g. "22h 0m left"
    expect(screen.queryByText(/overdue/i)).toBeNull()
  })

  it("renders an Overdue badge once the deadline has passed", () => {
    const createdAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() // 48h ago

    render(
      <TooltipProvider>
        <ShipTimeCell createdAt={createdAt} handlingHours={24} />
      </TooltipProvider>
    )

    expect(screen.getByText(/overdue/i)).toBeTruthy()
  })

  it("renders the defined no-SLA state when the sales channel has no handling_hours configured", () => {
    render(
      <TooltipProvider>
        <ShipTimeCell createdAt={new Date().toISOString()} handlingHours={null} />
      </TooltipProvider>
    )

    expect(screen.getByText(/no sla set/i)).toBeTruthy()
    expect(screen.queryByText(/overdue/i)).toBeNull()
  })

  it("renders the same no-SLA state when handlingHours is undefined", () => {
    render(
      <TooltipProvider>
        <ShipTimeCell
          createdAt={new Date().toISOString()}
          handlingHours={undefined}
        />
      </TooltipProvider>
    )

    expect(screen.getByText(/no sla set/i)).toBeTruthy()
  })
})
