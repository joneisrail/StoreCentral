// @vitest-environment jsdom
import { useState } from "react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, userEvent } from "../../../../test/render"
import Drawer from "./index"

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= RO
  // jsdom has no Web Animations; headless-ui transitions wait on this
  ;(Element.prototype as unknown as { getAnimations?: unknown }).getAnimations ??= () => []
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  window.scrollTo = (() => {}) as typeof window.scrollTo
})

afterEach(cleanup)

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 150))
  })
}

function Harness({
  onClose = () => {},
  children,
}: {
  onClose?: () => void
  children?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button data-testid="opener" onClick={() => setOpen(true)}>
        Open
      </button>
      <Drawer
        open={open}
        title="Menu title"
        onClose={() => {
          onClose()
          setOpen(false)
        }}
      >
        {children}
      </Drawer>
    </div>
  )
}

async function openIt() {
  const opener = document.querySelector('[data-testid="opener"]') as HTMLElement
  await act(async () => {
    await userEvent.click(opener)
  })
  return opener
}

describe("Drawer", () => {
  it("shows a dialog named by title", async () => {
    render(<Harness>content</Harness>)
    await openIt()
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog).not.toBeNull()
    expect(dialog.getAttribute("aria-modal")).toBe("true")
    const labelId = dialog.getAttribute("aria-labelledby")!
    expect(document.getElementById(labelId)?.textContent).toBe("Menu title")
  })

  it("focuses the close button when children have nothing focusable", async () => {
    render(<Harness>just text</Harness>)
    await openIt()
    const close = document.querySelector('button[aria-label="Close"]')
    expect(close).not.toBeNull()
    expect(document.activeElement).toBe(close)
  })

  it("Escape calls onClose", async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose}>x</Harness>)
    await openIt()
    await act(async () => {
      await userEvent.keyboard("{Escape}")
    })
    await settle()
    expect(onClose).toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it("overlay click calls onClose", async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose}>x</Harness>)
    await openIt()
    const overlay = document.querySelector(
      "[data-drawer-overlay]"
    ) as HTMLElement
    await act(async () => {
      await userEvent.click(overlay)
    })
    expect(onClose).toHaveBeenCalled()
  })

  it("returns focus to the opener after close", async () => {
    render(<Harness>x</Harness>)
    const opener = await openIt()
    await act(async () => {
      await userEvent.keyboard("{Escape}")
    })
    await settle()
    expect(document.activeElement).toBe(opener)
  })

  it("does not throw when the opener unmounts while open", async () => {
    function Unmounting() {
      const [open, setOpen] = useState(false)
      const [gone, setGone] = useState(false)
      return (
        <div>
          {!gone && (
            <button data-testid="opener" onClick={() => setOpen(true)}>
              Open
            </button>
          )}
          <Drawer open={open} title="T" onClose={() => setOpen(false)}>
            <button data-testid="remove" onClick={() => setGone(true)}>
              remove
            </button>
          </Drawer>
        </div>
      )
    }
    render(<Unmounting />)
    await openIt()
    await act(async () => {
      await userEvent.click(
        document.querySelector('[data-testid="remove"]') as HTMLElement
      )
    })
    await act(async () => {
      await userEvent.keyboard("{Escape}")
    })
    await settle()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })
})
