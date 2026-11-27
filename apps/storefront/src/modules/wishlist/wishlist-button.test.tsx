// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, userEvent } from "../../test/render"

const loadButton = async () => {
  vi.resetModules()
  const { ToastProvider } = await import(
    "@modules/common/components/toast"
  )
  const { default: WishlistButton } = await import("./wishlist-button")
  return { ToastProvider, WishlistButton }
}

const setup = async () => {
  const { ToastProvider, WishlistButton } = await loadButton()
  return render(
    <ToastProvider>
      <WishlistButton productId="prod_1" title="Oud" />
    </ToastProvider>
  )
}

const button = () => document.querySelector("button") as HTMLButtonElement

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("WishlistButton", () => {
  it("toggles aria-pressed, label and toast, and persists", async () => {
    await setup()
    expect(button().getAttribute("aria-pressed")).toBe("false")
    expect(button().getAttribute("aria-label")).toBe("Add Oud to wishlist")
    expect(button().getAttribute("type")).toBe("button")

    await act(async () => {
      await userEvent.click(button())
    })
    expect(button().getAttribute("aria-pressed")).toBe("true")
    expect(button().getAttribute("aria-label")).toBe("Remove Oud from wishlist")
    expect(window.localStorage.getItem("sc-wishlist")).toBe('["prod_1"]')
    expect(document.body.textContent).toContain("Added to wishlist")

    await act(async () => {
      await userEvent.click(button())
    })
    expect(button().getAttribute("aria-pressed")).toBe("false")
    expect(window.localStorage.getItem("sc-wishlist")).toBe("[]")
    expect(document.body.textContent).toContain("Removed from wishlist")
  })

  it("reads an existing value on mount", async () => {
    window.localStorage.setItem("sc-wishlist", '["prod_1","prod_2"]')
    await setup()
    expect(button().getAttribute("aria-pressed")).toBe("true")
  })

  it("starts empty with corrupt JSON", async () => {
    window.localStorage.setItem("sc-wishlist", "{not json")
    await setup()
    expect(button().getAttribute("aria-pressed")).toBe("false")
  })

  it("still toggles when localStorage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied")
    })
    await setup()
    await act(async () => {
      await userEvent.click(button())
    })
    expect(button().getAttribute("aria-pressed")).toBe("true")
  })

  it("does not propagate clicks to a parent", async () => {
    const { ToastProvider, WishlistButton } = await loadButton()
    const onParent = vi.fn()
    render(
      <ToastProvider>
        <div onClick={onParent}>
          <WishlistButton productId="prod_1" title="Oud" />
        </div>
      </ToastProvider>
    )
    await act(async () => {
      await userEvent.click(button())
    })
    expect(onParent).not.toHaveBeenCalled()
  })

  it("updates a mounted heart on a storage event", async () => {
    await setup()
    expect(button().getAttribute("aria-pressed")).toBe("false")
    window.localStorage.setItem("sc-wishlist", '["prod_1"]')
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: "sc-wishlist" }))
    })
    expect(button().getAttribute("aria-pressed")).toBe("true")
  })

  it("keeps the in-memory list across toggles and resyncs when storage recovers", async () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("denied")
      })
    await setup()
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await userEvent.click(button())
      })
    }
    expect(button().getAttribute("aria-pressed")).toBe("true")
    expect(window.localStorage.getItem("sc-wishlist")).toBeNull()

    setItem.mockRestore()
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        await userEvent.click(button())
      })
    }
    expect(button().getAttribute("aria-pressed")).toBe("true")
    expect(window.localStorage.getItem("sc-wishlist")).toBe('["prod_1"]')
  })

  it("keeps unsaved toggles after every heart unmounts", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied")
    })
    const { ToastProvider, WishlistButton } = await loadButton()
    const ui = (
      <ToastProvider>
        <WishlistButton productId="prod_1" title="Oud" />
      </ToastProvider>
    )
    const first = render(ui)
    await act(async () => {
      await userEvent.click(button())
    })
    expect(button().getAttribute("aria-pressed")).toBe("true")
    first.unmount()
    render(ui)
    expect(button().getAttribute("aria-pressed")).toBe("true")
  })

  it("re-reads storage after a persisted toggle clears the unsaved flag", async () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("denied")
      })
    const { ToastProvider, WishlistButton } = await loadButton()
    const ui = (
      <ToastProvider>
        <WishlistButton productId="prod_1" title="Oud" />
      </ToastProvider>
    )
    const first = render(ui)
    await act(async () => {
      await userEvent.click(button())
    })
    setItem.mockRestore()
    await act(async () => {
      await userEvent.click(button())
    })
    await act(async () => {
      await userEvent.click(button())
    })
    expect(window.localStorage.getItem("sc-wishlist")).toBe('["prod_1"]')
    first.unmount()
    window.localStorage.setItem("sc-wishlist", "[]")
    render(ui)
    expect(button().getAttribute("aria-pressed")).toBe("false")
  })
})
