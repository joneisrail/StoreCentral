// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { act, cleanup, render } from "../../../../test/render"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  usePathname: () => "/",
}))

import SideMenu from "./index"

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= RO
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

describe("side menu", () => {
  it("renders the storeName prop in the copyright line", async () => {
    render(
      <SideMenu
        locales={null}
        currentLocale={null}
        storeName="Maison Test"
      />
    )
    const button = document.querySelector(
      '[data-testid="nav-menu-button"]'
    ) as HTMLButtonElement
    await act(async () => {
      button.click()
      await new Promise((r) => setTimeout(r, 150))
    })
    expect(document.body.textContent).toContain("Maison Test")
    expect(document.body.textContent).not.toContain("Store. All rights")
  })
})
