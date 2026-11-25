// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, userEvent } from "../../../../test/render"
import DropdownMenu from "./index"

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= RO
  // jsdom has no Web Animations; headless-ui transitions wait on this
  ;(Element.prototype as unknown as { getAnimations?: unknown }).getAnimations ??= () => []
})

afterEach(cleanup)

const button = () => document.querySelector("button") as HTMLButtonElement
const menuItems = () =>
  Array.from(document.querySelectorAll('[role="menuitem"]')) as HTMLElement[]

async function key(k: string) {
  await act(async () => {
    await userEvent.keyboard(k)
  })
}

describe("DropdownMenu", () => {
  it("opens on click and sets aria-expanded", async () => {
    render(<DropdownMenu label="Account" items={[{ label: "One" }]} />)
    expect(button().getAttribute("aria-expanded")).toBe("false")
    await act(async () => {
      await userEvent.click(button())
    })
    expect(button().getAttribute("aria-expanded")).toBe("true")
    expect(menuItems().length).toBe(1)
  })

  it("ArrowDown then Enter fires the second item onSelect", async () => {
    const a = vi.fn()
    const b = vi.fn()
    render(
      <DropdownMenu
        label="Account"
        items={[
          { label: "A", onSelect: a },
          { label: "B", onSelect: b },
        ]}
      />
    )
    await act(async () => {
      button().focus()
    })
    await key("{ArrowDown}")
    await key("{ArrowDown}")
    await key("{Enter}")
    expect(b).toHaveBeenCalledTimes(1)
    expect(a).not.toHaveBeenCalled()
  })

  it("skips disabled items", async () => {
    const b = vi.fn()
    const c = vi.fn()
    render(
      <DropdownMenu
        label="Account"
        items={[
          { label: "A" },
          { label: "B", onSelect: b, disabled: true },
          { label: "C", onSelect: c },
        ]}
      />
    )
    await act(async () => {
      button().focus()
    })
    await key("{ArrowDown}")
    await key("{ArrowDown}")
    await key("{Enter}")
    expect(c).toHaveBeenCalledTimes(1)
    expect(b).not.toHaveBeenCalled()
  })

  it("Escape closes and returns focus to the button", async () => {
    render(<DropdownMenu label="Account" items={[{ label: "A" }]} />)
    await act(async () => {
      await userEvent.click(button())
    })
    await key("{Escape}")
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150))
    })
    expect(menuItems().length).toBe(0)
    expect(button().getAttribute("aria-expanded")).toBe("false")
    expect(document.activeElement).toBe(button())
  })

  it("renders href items as links", async () => {
    render(
      <DropdownMenu
        label="Account"
        items={[{ label: "Go", href: "/account" }]}
      />
    )
    await act(async () => {
      await userEvent.click(button())
    })
    const link = document.querySelector('a[href="/account"]')
    expect(link).not.toBeNull()
    expect(link?.textContent).toBe("Go")
  })
})
