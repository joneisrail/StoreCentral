// @vitest-environment jsdom
// Real react-instantsearch against a fake client, for the failure path the
// hook-level mocks in search-overlay.test.tsx cannot reach.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, userEvent } from "../../../../test/render"

const is = vi.hoisted(() => ({
  fail: true,
  calls: 0,
}))

vi.mock("@lib/search-client", () => ({
  PRODUCT_INDEX_NAME: "product",
  priceAttribute: (field: string, currency: string) => `${field}_${currency}`,
  indexedCurrency: (currency: string) => currency,
  searchClient: {
    search: async (requests: { params?: { query?: string } }[]) => {
      is.calls++
      if (is.fail) {
        throw new Error("ECONNREFUSED 10.0.0.3:7700")
      }
      return {
        results: requests.map((r) => ({
          hits: [
            {
              objectID: "p1",
              title: "Rose One",
              handle: "rose-one",
              thumbnail: null,
            },
          ],
          nbHits: 1,
          page: 0,
          nbPages: 1,
          hitsPerPage: 8,
          processingTimeMS: 1,
          query: r.params?.query ?? "",
          params: "",
          exhaustiveNbHits: true,
        })),
      }
    },
    searchForFacetValues: async () => [],
    clearCache: () => {},
  },
}))

vi.mock("@medusajs/icons", () => ({
  MagnifyingGlass: () => <svg aria-hidden="true" />,
  XMark: () => <svg aria-hidden="true" />,
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}))
vi.mock("@modules/common/components/localized-client-link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import Search from "./index"

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= RO
  ;(Element.prototype as unknown as { getAnimations?: unknown }).getAnimations ??=
    () => []
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

async function wait(ms: number) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms))
  })
}

const text = (id: string) =>
  document.querySelector(`[data-testid="${id}"]`)?.textContent ?? null

describe("Search overlay against a failing client", () => {
  it("shows the fixed error text when the search rejects, and clears it on recovery", async () => {
    is.fail = true
    const { container } = render(<Search currencyCode="usd" />)
    await userEvent.click(
      container.querySelector('[data-testid="nav-search-field"]') as HTMLElement
    )
    await wait(100)
    const input = document.querySelector('[role="combobox"]') as HTMLInputElement

    await userEvent.type(input, "ysl")
    await wait(400)
    expect(is.calls).toBeGreaterThan(0)
    expect(text("search-loading")).toBeNull()
    expect(text("search-error")).toBe(
      "Search is unavailable right now. Please try again."
    )
    expect(document.body.textContent).not.toContain("ECONNREFUSED")

    is.fail = false
    await userEvent.type(input, "x")
    await wait(400)
    expect(text("search-error")).toBeNull()
    expect(
      document.querySelector('[data-kind="product"]')?.textContent
    ).toContain("Rose One")
  })
})
