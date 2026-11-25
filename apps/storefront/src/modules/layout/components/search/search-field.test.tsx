// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, userEvent } from "../../../../test/render"

vi.mock("@lib/search-client", () => ({
  PRODUCT_INDEX_NAME: "product",
  searchClient: {
    search: async () => ({ results: [] }),
    searchForFacetValues: async () => [],
  },
}))

vi.mock("@medusajs/icons", () => ({
  MagnifyingGlass: () => <svg aria-hidden="true" />,
  XMark: () => <svg aria-hidden="true" />,
}))

vi.mock("react-instantsearch", () => ({
  Configure: () => null,
  InstantSearch: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useHits: () => ({ items: [] }),
  useInstantSearch: () => ({ status: "idle", error: undefined }),
  useSearchBox: () => ({ query: "", refine: () => {} }),
}))

vi.mock("@lib/hooks/use-search-settled", () => ({
  default: () => ({ isSettled: true }),
}))

import Search from "./index"

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

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 150))
  })
}

describe("Search triggers", () => {
  it.each(["nav-search-field", "nav-search-button"])(
    "%s opens the drawer",
    async (id) => {
      const { container } = render(<Search />)
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      await userEvent.click(
        container.querySelector(`[data-testid="${id}"]`) as HTMLElement
      )
      await settle()
      expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    }
  )

  it("gives both triggers an accessible name", () => {
    const { container } = render(<Search />)
    const button = container.querySelector(
      '[data-testid="nav-search-button"]'
    ) as HTMLElement
    const field = container.querySelector(
      '[data-testid="nav-search-field"]'
    ) as HTMLElement
    expect(button.getAttribute("aria-label")).toBe("Search products")
    expect(field.textContent).toContain("Search products")
    expect(field.className).toContain("small:flex")
    expect(button.className).toContain("small:hidden")
  })
})
