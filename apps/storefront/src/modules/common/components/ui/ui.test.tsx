// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"

import { cleanup, render, userEvent } from "../../../../test/render"
import { Badge, Button, Checkbox, Input } from "./index"

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

describe("Badge contrast", () => {
  const hex: Record<string, string> = {
    "bg-line": "#e6dfd3",
    "bg-ivory": "#faf7f2",
    "text-charcoal": "#1e1d1b",
    "text-gold-deep": "#80651f",
    "bg-green-100": "#dcfce7",
    "text-green-700": "#15803d",
    "bg-red-100": "#fee2e2",
    "text-red-700": "#b91c1c",
    "bg-orange-100": "#ffedd5",
    "text-orange-700": "#c2410c",
  }
  const lum = (h: string) => {
    const c = [1, 3, 5]
      .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)]
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
  }

  it.each(["green", "red", "blue", "orange", "grey", "purple"] as const)(
    "%s badge text has at least 4.5:1 contrast",
    (color) => {
      const { container } = render(<Badge color={color}>x</Badge>)
      const classes = container.querySelector("span")!.className.split(" ")
      const bg = classes.find((c) => c.startsWith("bg-"))!
      const fg = classes.find((c) => c.startsWith("text-") && c !== "text-xs")!
      expect(ratio(hex[bg], hex[fg])).toBeGreaterThanOrEqual(4.5)
    }
  )
})
