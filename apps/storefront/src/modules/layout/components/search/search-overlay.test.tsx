// @vitest-environment jsdom
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { act, cleanup, render, userEvent } from "../../../../test/render"

type FakeState = {
  query: string
  status: "idle" | "loading" | "stalled" | "error"
  error: Error | undefined
  results: Record<string, unknown> | undefined
}

const is = vi.hoisted(() => ({
  state: {
    query: "",
    status: "idle",
    error: undefined,
    results: undefined,
  } as FakeState,
  search: vi.fn(),
  push: vi.fn(),
  track: vi.fn(),
}))

vi.mock("@lib/search-client", () => ({
  PRODUCT_INDEX_NAME: "product",
  searchClient: {
    search: async () => ({ results: [] }),
    searchForFacetValues: async () => [],
  },
  priceAttribute: (field: string, currency: string) => `${field}_${currency}`,
  indexedCurrency: (currency: string) => currency,
}))

vi.mock("@medusajs/icons", () => ({
  MagnifyingGlass: () => <svg aria-hidden="true" />,
  XMark: () => <svg aria-hidden="true" />,
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: is.push }),
}))

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}))

vi.mock("@modules/common/components/localized-client-link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock("@lib/data/track-search", () => ({ trackSearch: is.track }))

vi.mock("@lib/util/recent-searches", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@lib/util/recent-searches")>()
  return { ...actual, addRecentSearch: vi.fn(actual.addRecentSearch) }
})

vi.mock("react-instantsearch", () => ({
  Configure: () => null,
  InstantSearch: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useSearchBox: ({
    queryHook,
  }: {
    queryHook: (q: string, search: (q: string) => void) => void
  }) => ({
    query: is.state.query,
    refine: (value: string) => queryHook(value, is.search),
  }),
  useInstantSearch: () => ({
    status: is.state.status,
    error: is.state.error,
    results: is.state.results,
  }),
}))

import { addRecentSearch, RECENT_SEARCHES_KEY } from "@lib/util/recent-searches"
import Search from "./index"
import type { SearchInsights } from "./index"

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

beforeEach(() => {
  is.state = { query: "", status: "idle", error: undefined, results: undefined }
  is.search.mockClear()
  is.push.mockClear()
  is.track.mockClear()
  vi.mocked(addRecentSearch).mockClear()
  window.localStorage.clear()
})

afterEach(cleanup)

async function wait(ms = 150) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms))
  })
}

const noInsights = (): Promise<SearchInsights> =>
  Promise.resolve({ popular: null, trending: null })

function hit(id: string, title: string, highlighted?: string) {
  return {
    objectID: id,
    title,
    handle: id,
    thumbnail: null,
    brand: ["Maison"],
    min_price_usd: 120,
    max_price_usd: 120,
    ...(highlighted
      ? { _highlightResult: { title: { value: highlighted } } }
      : {}),
  }
}

/** Puts InstantSearch in the settled state for `query`. */
function settledOn(query: string, hits: unknown[], nbHits = hits.length) {
  is.state = {
    query,
    status: "idle",
    error: undefined,
    results: {
      _state: { query },
      hits,
      nbHits,
      facets: [
        { name: "brand", data: { Maison: 2 } },
        { name: "category", data: { "Eau de Parfum": 2 } },
      ],
    },
  }
}

async function openSearch(insights: Promise<SearchInsights> = noInsights()) {
  const utils = render(<Search currencyCode="usd" insights={insights} />)
  const trigger = utils.container.querySelector(
    '[data-testid="nav-search-field"]'
  ) as HTMLElement
  await userEvent.click(trigger)
  await wait()
  const input = document.querySelector('[role="combobox"]') as HTMLInputElement
  return { ...utils, trigger, input }
}

const active = (input: HTMLInputElement) => {
  const id = input.getAttribute("aria-activedescendant")
  return id ? document.getElementById(id) : null
}

describe("Search triggers", () => {
  it.each(["nav-search-field", "nav-search-button"])(
    "%s opens the overlay",
    async (id) => {
      const { container } = render(<Search currencyCode="usd" />)
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      await userEvent.click(
        container.querySelector(`[data-testid="${id}"]`) as HTMLElement
      )
      await wait()
      expect(document.querySelector('[role="dialog"]')).not.toBeNull()
      expect(document.querySelector('[role="combobox"]')).not.toBeNull()
    }
  )

  it("gives both triggers an accessible name", () => {
    const { container } = render(<Search currencyCode="usd" />)
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

describe("Search overlay", () => {
  it("wires the combobox to its listbox", async () => {
    const { input } = await openSearch()
    const listbox = document.getElementById(
      input.getAttribute("aria-controls") as string
    )
    expect(listbox?.getAttribute("role")).toBe("listbox")
    expect(input.getAttribute("aria-autocomplete")).toBe("list")
  })

  it("debounces typing into a single request", async () => {
    const { input } = await openSearch()
    await userEvent.type(input, "rose")
    expect(is.search).not.toHaveBeenCalled()
    await wait(300)
    expect(is.search).toHaveBeenCalledTimes(1)
    expect(is.search).toHaveBeenCalledWith("rose")
  })

  it("moves aria-activedescendant across sections and wraps", async () => {
    settledOn("rose", [hit("p1", "Rose One"), hit("p2", "Rose Two")])
    const { input } = await openSearch()
    expect(input.value).toBe("rose")
    expect(input.getAttribute("aria-expanded")).toBe("true")
    expect(input.getAttribute("aria-activedescendant")).toBeNull()

    const seen: (string | null | undefined)[] = []
    for (let i = 0; i < 5; i++) {
      await userEvent.keyboard("{ArrowDown}")
      seen.push(active(input)?.getAttribute("data-kind"))
    }
    expect(seen).toEqual(["product", "product", "brand", "category", "all"])
    expect(active(input)?.getAttribute("role")).toBe("option")
    expect(active(input)?.getAttribute("aria-selected")).toBe("true")

    await userEvent.keyboard("{ArrowDown}")
    expect(input.getAttribute("aria-activedescendant")).toBeNull()
    await userEvent.keyboard("{ArrowDown}")
    expect(active(input)?.textContent).toContain("Rose One")
    await userEvent.keyboard("{ArrowUp}{ArrowUp}")
    expect(active(input)?.getAttribute("data-kind")).toBe("all")
    expect(active(input)?.textContent).toContain("See all results for “rose”")
  })

  it("Enter on the input records the search once and goes to /search", async () => {
    settledOn("rose oud", [hit("p1", "Rose One")], 12)
    const { input } = await openSearch()
    await userEvent.keyboard("{Enter}")
    expect(addRecentSearch).toHaveBeenCalledTimes(1)
    expect(addRecentSearch).toHaveBeenCalledWith("rose oud")
    expect(is.track).toHaveBeenCalledTimes(1)
    expect(is.track).toHaveBeenCalledWith("rose oud", 12)
    expect(is.push).toHaveBeenCalledWith("/search?q=rose%20oud")
    await wait()
    expect(document.querySelector('[role="combobox"]')).toBeNull()
    expect(input.isConnected).toBe(false)
  })

  it("Enter on a highlighted row navigates to it", async () => {
    settledOn("rose", [hit("p1", "Rose One")])
    await openSearch()
    await userEvent.keyboard("{ArrowDown}{Enter}")
    expect(is.push).toHaveBeenCalledWith("/products/p1")
    expect(is.track).toHaveBeenCalledTimes(1)
  })

  it("Escape closes and returns focus to the trigger", async () => {
    const { trigger } = await openSearch()
    await userEvent.keyboard("{Escape}")
    await wait()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it("empty input shows recent searches and hides popular when null", async () => {
    window.localStorage.setItem(
      RECENT_SEARCHES_KEY,
      JSON.stringify(["vanilla musk", "oud"])
    )
    await openSearch(
      Promise.resolve({
        popular: null,
        trending: [
          { id: "t1", title: "Trend One", handle: "trend-one", thumbnail: null },
        ],
      })
    )
    const recent = document.querySelector('[data-testid="search-recent"]')
    expect(recent?.textContent).toContain("vanilla musk")
    expect(recent?.textContent).toContain("oud")
    expect(document.querySelector('[data-testid="search-popular"]')).toBeNull()
    expect(
      document.querySelector('[data-testid="search-trending"]')?.textContent
    ).toContain("Trend One")
    expect(is.track).not.toHaveBeenCalled()
  })

  it("removes and clears recent searches", async () => {
    window.localStorage.setItem(
      RECENT_SEARCHES_KEY,
      JSON.stringify(["vanilla musk", "oud"])
    )
    await openSearch()
    await userEvent.click(
      document.querySelector(
        '[aria-label="Remove vanilla musk from recent searches"]'
      ) as HTMLElement
    )
    const recent = () => document.querySelector('[data-testid="search-recent"]')
    expect(recent()?.textContent).not.toContain("vanilla musk")
    expect(JSON.parse(window.localStorage.getItem(RECENT_SEARCHES_KEY)!)).toEqual(
      ["oud"]
    )
    await userEvent.click(
      document.querySelector('[data-testid="search-recent-clear"]') as HTMLElement
    )
    expect(recent()).toBeNull()
  })

  it("renders popular searches when the fetch returned a list", async () => {
    await openSearch(
      Promise.resolve({ popular: ["amber", "lattafa"], trending: [] })
    )
    expect(
      document.querySelector('[data-testid="search-popular"]')?.textContent
    ).toContain("lattafa")
    expect(document.querySelector('[data-testid="search-trending"]')).toBeNull()
  })

  it("shows the fixed error text, never the raw error", async () => {
    is.state = {
      query: "rose",
      status: "error",
      error: new Error("ECONNREFUSED 10.0.0.3:7700"),
      results: undefined,
    }
    await openSearch()
    const error = document.querySelector('[data-testid="search-error"]')
    expect(error?.textContent).toBe(
      "Search is unavailable right now. Please try again."
    )
    expect(document.body.textContent).not.toContain("ECONNREFUSED")
  })

  it("shows a no-results state", async () => {
    settledOn("zzzz", [], 0)
    await openSearch()
    expect(
      document.querySelector('[data-testid="search-no-results"]')?.textContent
    ).toContain("zzzz")
  })

  it("shows a loading state while the results belong to another query", async () => {
    settledOn("ros", [hit("p1", "Rose One")])
    is.state.query = "rose"
    await openSearch()
    expect(document.querySelector('[data-testid="search-loading"]')).not.toBeNull()
    expect(document.body.textContent).not.toContain("Rose One")
  })

  it("renders highlighted titles as text, escaping markup", async () => {
    settledOn("rose", [
      hit("p1", "Rose <img onerror=x>", "<mark>Rose</mark> <img onerror=x>"),
    ])
    await openSearch()
    const row = document.querySelector('[data-kind="product"]') as HTMLElement
    expect(row.querySelector("mark")?.textContent).toBe("Rose")
    expect(row.querySelector("img[onerror]")).toBeNull()
    expect(row.textContent).toContain("<img onerror=x>")
    expect(row.textContent).toContain("Maison")
    expect(row.textContent).toContain("$120.00")
  })
})
