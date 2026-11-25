// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, userEvent } from "../../../../test/render"

import AnnouncementBar from "./index"

const realStorage = Object.getOwnPropertyDescriptor(window, "sessionStorage")

afterEach(() => {
  cleanup()
  if (realStorage) {
    Object.defineProperty(window, "sessionStorage", realStorage)
  }
  window.sessionStorage.clear()
  vi.restoreAllMocks()
})

describe("AnnouncementBar", () => {
  it("renders text and link", () => {
    const { container } = render(
      <AnnouncementBar text="Free shipping" href="/store" />
    )
    expect(container.textContent).toContain("Free shipping")
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/store")
  })

  it("dismisses and stores the key", async () => {
    const { container } = render(<AnnouncementBar text="Free shipping" />)
    const btn = container.querySelector(
      'button[aria-label="Dismiss announcement"]'
    ) as HTMLButtonElement
    await act(async () => {
      await userEvent.click(btn)
    })
    expect(container.textContent).not.toContain("Free shipping")
    expect(
      window.sessionStorage.getItem("sc-announcement-dismissed:Free shipping")
    ).not.toBeNull()
  })

  it("works with throwing storage", async () => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: {
        getItem() {
          throw new Error("denied")
        },
        setItem() {
          throw new Error("denied")
        },
      },
    })
    const { container } = render(<AnnouncementBar text="Free shipping" />)
    expect(container.textContent).toContain("Free shipping")
    const btn = container.querySelector("button") as HTMLButtonElement
    await act(async () => {
      await userEvent.click(btn)
    })
    expect(container.textContent).not.toContain("Free shipping")
  })

  it("renders nothing when previously dismissed", () => {
    window.sessionStorage.setItem("sc-announcement-dismissed:Free shipping", "1")
    const { container } = render(<AnnouncementBar text="Free shipping" />)
    expect(container.textContent).not.toContain("Free shipping")
  })
})
