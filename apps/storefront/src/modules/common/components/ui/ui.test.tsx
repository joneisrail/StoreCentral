// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"

import { cleanup, render, userEvent } from "../../../../test/render"
import { Button, Checkbox, Input } from "./index"

afterEach(cleanup)

describe("Button", () => {
  it("renders four variants with distinct classes", () => {
    const variants = ["primary", "secondary", "transparent", "gold"] as const
    const classes = variants.map((variant) => {
      const { container, unmount } = render(
        <Button variant={variant}>Go</Button>
      )
      const value = container.querySelector("button")!.className
      unmount()
      return value
    })
    expect(new Set(classes).size).toBe(4)
  })

  it("gold variant is charcoal text on gold fill", () => {
    const { container } = render(<Button variant="gold">Go</Button>)
    const cls = container.querySelector("button")!.className
    expect(cls).toContain("bg-gold")
    expect(cls).toContain("text-charcoal")
  })

  it("isLoading disables and shows Loading...", () => {
    const { container } = render(<Button isLoading>Go</Button>)
    const button = container.querySelector("button")!
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe("Loading...")
  })

  it("respects disabled", () => {
    const { container } = render(<Button disabled>Go</Button>)
    expect(container.querySelector("button")!.disabled).toBe(true)
  })

  it("has focus ring, touch target and reduced motion classes", () => {
    const { container } = render(<Button>Go</Button>)
    const cls = container.querySelector("button")!.className
    expect(cls).toContain("focus-visible:ring-gold-deep")
    expect(cls).toContain("min-h-[44px]")
    expect(cls).toContain("motion-reduce:transition-none")
  })
})

describe("Input", () => {
  it("shows its label and passes data-testid through", () => {
    const { container } = render(
      <Input label="Email" data-testid="email-input" />
    )
    expect(container.textContent).toContain("Email")
    expect(
      container.querySelector("[data-testid='email-input']")
    ).not.toBeNull()
  })
})

describe("Checkbox", () => {
  it("toggles with the keyboard (Space)", async () => {
    const user = userEvent.setup()
    const { container } = render(<Checkbox label="Agree" id="agree" />)
    const input = container.querySelector("input")!
    expect(input.checked).toBe(false)
    input.focus()
    await user.keyboard(" ")
    expect(input.checked).toBe(true)
  })
})
