// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      return options ? `${key}:${JSON.stringify(options)}` : key
    },
  }),
}))

import { OverdueBanner } from "./overdue-banner"

afterEach(cleanup)

describe("OverdueBanner", () => {
  it("shows the count and toggles on click", async () => {
    const onToggle = vi.fn()
    const user = userEvent.setup()

    render(<OverdueBanner count={3} active={false} onToggle={onToggle} />)

    const button = screen.getByRole("button")
    expect(button.textContent).toContain(
      `orders.readyToShip.overdueBanner:{"count":3}`
    )
    expect(button.getAttribute("aria-pressed")).toBe("false")

    await user.click(button)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it("reflects the active state", () => {
    render(<OverdueBanner count={2} active onToggle={() => {}} />)
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true")
  })

  it("renders nothing when there are no overdue orders", () => {
    const { container } = render(
      <OverdueBanner count={0} active={false} onToggle={() => {}} />
    )
    expect(container.textContent).toBe("")
  })
})
