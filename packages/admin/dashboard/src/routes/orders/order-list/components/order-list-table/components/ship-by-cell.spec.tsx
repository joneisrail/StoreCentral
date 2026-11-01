// @vitest-environment jsdom
import { TooltipProvider } from "@medusajs/ui"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

// `use-date.tsx` (behind `DateCell`, rendered whenever `handlingHours` is
// set) reads `i18n.language` directly via `useTranslation`, not just `t` -
// same convention as `ready-to-ship-table.spec.tsx`.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}))

import { ShipByCell } from "./ship-by-cell"

afterEach(() => {
  cleanup()
})

describe("ShipByCell", () => {
  it("renders the deadline date and a live countdown when not yet overdue", () => {
    const createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() // 2h ago

    render(
      <TooltipProvider>
        <ShipByCell createdAt={createdAt} handlingHours={24} />
      </TooltipProvider>
    )

    expect(screen.getByText(/left/i)).toBeTruthy() // e.g. "22h left"
    expect(screen.queryByText(/overdue/i)).toBeNull()
  })

  it("renders an Overdue badge once the deadline has passed", () => {
    const createdAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() // 48h ago

    render(
      <TooltipProvider>
        <ShipByCell createdAt={createdAt} handlingHours={24} />
      </TooltipProvider>
    )

    expect(screen.getByText(/overdue/i)).toBeTruthy()
  })

  it("renders a defined no-SLA state when the sales channel has no handling_hours configured", () => {
    render(
      <TooltipProvider>
        <ShipByCell createdAt={new Date().toISOString()} handlingHours={null} />
      </TooltipProvider>
    )

    expect(screen.getByText(/no sla set/i)).toBeTruthy()
    expect(screen.queryByText(/overdue/i)).toBeNull()
  })

  it("renders the same no-SLA state when handlingHours is undefined", () => {
    render(
      <TooltipProvider>
        <ShipByCell
          createdAt={new Date().toISOString()}
          handlingHours={undefined}
        />
      </TooltipProvider>
    )

    expect(screen.getByText(/no sla set/i)).toBeTruthy()
  })
})
