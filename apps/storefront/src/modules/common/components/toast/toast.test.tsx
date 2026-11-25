// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render } from "../../../../test/render"
import { ToastProvider, useToast } from "./index"

type Api = ReturnType<typeof useToast>

let api: Api
function Capture() {
  api = useToast()
  return null
}

function setup() {
  return render(
    <ToastProvider>
      <Capture />
    </ToastProvider>
  )
}

function items() {
  return Array.from(document.querySelectorAll("[data-toast]")) as HTMLElement[]
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("toast", () => {
  it("shows a toast with its title and description", () => {
    setup()
    act(() => {
      api.toast({ title: "Saved", description: "All good" })
    })
    expect(document.body.textContent).toContain("Saved")
    expect(document.body.textContent).toContain("All good")
  })

  it("renders a labelled fixed region with the layout classes", () => {
    setup()
    const region = document.querySelector('[role="region"]') as HTMLElement
    expect(region.getAttribute("aria-label")).toBe("Notifications")
    for (const c of [
      "fixed",
      "bottom-0",
      "lg:top-0",
      "lg:right-0",
      "lg:bottom-auto",
      "max-h-screen",
      "overflow-y-auto",
    ]) {
      expect(region.className).toContain(c)
    }
  })

  it("auto-dismisses after the default 5000ms", () => {
    setup()
    act(() => {
      api.toast({ title: "Hi" })
    })
    advance(4999)
    expect(items().length).toBe(1)
    advance(1)
    expect(items().length).toBe(0)
  })

  it("honours a custom durationMs", () => {
    setup()
    act(() => {
      api.toast({ title: "Hi", durationMs: 1000 })
    })
    advance(1000)
    expect(items().length).toBe(0)
  })

  it("dismiss button removes only that toast", async () => {
    setup()
    act(() => {
      api.toast({ title: "One" })
      api.toast({ title: "Two" })
    })
    const buttons = document.querySelectorAll("button")
    act(() => {
      ;(buttons[0] as HTMLButtonElement).click()
    })
    expect(items().length).toBe(1)
    expect(items()[0].textContent).toContain("Two")
  })

  it("ten toasts render ten dismissible items; dismissing the fifth leaves nine", () => {
    setup()
    act(() => {
      for (let i = 1; i <= 10; i++) {
        api.toast({ title: `Toast ${i}`, durationMs: 60000 })
      }
    })
    expect(items().length).toBe(10)
    expect(document.querySelectorAll("[data-toast] button").length).toBe(10)
    act(() => {
      ;(items()[4].querySelector("button") as HTMLButtonElement).click()
    })
    const titles = items().map((i) => i.textContent ?? "")
    expect(titles.length).toBe(9)
    expect(titles.some((t) => t.includes("Toast 5"))).toBe(false)
    for (const n of [1, 2, 3, 4, 6, 7, 8, 9, 10]) {
      expect(titles.some((t) => t.includes(`Toast ${n}`))).toBe(true)
    }
    // each remaining stays dismissible
    expect(document.querySelectorAll("[data-toast] button").length).toBe(9)
    act(() => {
      ;(items()[0].querySelector("button") as HTMLButtonElement).click()
    })
    expect(items().length).toBe(8)
  })

  it("hover pauses the timer and leave resumes it", () => {
    setup()
    act(() => {
      api.toast({ title: "Hover", durationMs: 1000 })
    })
    advance(500)
    act(() => {
      items()[0].dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    })
    advance(5000)
    expect(items().length).toBe(1)
    act(() => {
      items()[0].dispatchEvent(new MouseEvent("mouseout", { bubbles: true }))
    })
    advance(499)
    expect(items().length).toBe(1)
    advance(1)
    expect(items().length).toBe(0)
  })

  it("error tone uses role alert, others role status", () => {
    setup()
    act(() => {
      api.toast({ title: "E", tone: "error" })
      api.toast({ title: "S", tone: "success" })
      api.toast({ title: "I" })
    })
    const roles = items().map((i) => i.getAttribute("role"))
    expect(roles).toEqual(["alert", "status", "status"])
  })

  it("toast returns an id usable with dismiss", () => {
    setup()
    let id = ""
    act(() => {
      id = api.toast({ title: "X" })
    })
    expect(typeof id).toBe("string")
    act(() => {
      api.dismiss(id)
    })
    expect(items().length).toBe(0)
  })

  it("useToast outside the provider throws a clear error", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => render(<Capture />)).toThrow(/useToast must be used within a ToastProvider/)
  })

  it("clears timers on unmount with no state updates afterwards", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const view = setup()
    act(() => {
      api.toast({ title: "Bye", durationMs: 1000 })
    })
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
    advance(2000)
    expect(errSpy).not.toHaveBeenCalled()
  })
})
