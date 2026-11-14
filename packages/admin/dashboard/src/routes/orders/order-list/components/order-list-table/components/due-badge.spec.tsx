// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      return options ? `${key}:${JSON.stringify(options)}` : key
    },
  }),
}))

import { DueBadge } from "./due-badge"

afterEach(cleanup)

const now = new Date("2026-11-14T12:00:00Z")
const props = { now, timeZone: "UTC" }

describe("DueBadge", () => {
  it("shows Overdue in red", () => {
    render(
      <DueBadge
        createdAt="2026-11-12T00:00:00Z"
        handlingHours={24}
        {...props}
      />
    )
    expect(
      screen.getByText("orders.readyToShip.due.overdue").className
    ).toContain("red")
  })

  it("shows Due today in orange", () => {
    render(
      <DueBadge createdAt="2026-11-14T10:00:00Z" handlingHours={6} {...props} />
    )
    expect(
      screen.getByText("orders.readyToShip.due.today").className
    ).toContain("orange")
  })

  it("shows Due tomorrow in blue", () => {
    render(
      <DueBadge
        createdAt="2026-11-14T10:00:00Z"
        handlingHours={24}
        {...props}
      />
    )
    expect(
      screen.getByText("orders.readyToShip.due.tomorrow").className
    ).toContain("blue")
  })

  it("shows Due in N days in grey", () => {
    render(
      <DueBadge
        createdAt="2026-11-14T10:00:00Z"
        handlingHours={96}
        {...props}
      />
    )
    expect(
      screen.getByText(`orders.readyToShip.due.days:{"days":4}`).className
    ).toContain("neutral")
  })

  it("renders nothing without handling hours", () => {
    const { container } = render(
      <DueBadge
        createdAt="2026-11-14T10:00:00Z"
        handlingHours={null}
        {...props}
      />
    )
    expect(container.textContent).toBe("")
  })

  it("renders nothing for an invalid time zone", () => {
    const { container } = render(
      <DueBadge
        createdAt="2026-11-14T10:00:00Z"
        handlingHours={6}
        now={now}
        timeZone="Not/AZone"
      />
    )
    expect(container.textContent).toBe("")
  })
})
