// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { EmailToggle } from "./email-toggle"

afterEach(cleanup)

describe("EmailToggle", () => {
  it("reflects the checked state and reports changes", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(<EmailToggle orderId="o1" checked onCheckedChange={onChange} />)

    const toggle = screen.getByRole("switch")
    expect(toggle.getAttribute("aria-checked")).toBe("true")

    await user.click(toggle)
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it("renders unchecked", () => {
    render(
      <EmailToggle orderId="o1" checked={false} onCheckedChange={() => {}} />
    )
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "false"
    )
  })
})
