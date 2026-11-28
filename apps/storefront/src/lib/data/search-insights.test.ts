import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@lib/config", () => ({ sdk: { client: { fetch: vi.fn() } } }))

import { sdk } from "@lib/config"
import { getPopularSearches, getTrendingProducts } from "./search-insights"

const fetchMock = sdk.client.fetch as unknown as ReturnType<typeof vi.fn>

describe("getPopularSearches", () => {
  beforeEach(() => vi.resetAllMocks())

  it("maps queries to strings with a timeout signal and revalidate", async () => {
    fetchMock.mockResolvedValue({
      queries: [
        { query: "oud", count: 5 },
        { query: "lattafa", count: 3 },
      ],
    })
    expect(await getPopularSearches()).toEqual(["oud", "lattafa"])
    const [path, init] = fetchMock.mock.calls[0]
    expect(path).toBe("/store/search/popular")
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.next).toEqual({ revalidate: 300 })
  })

  it("returns null on failure, timeout or bad shape", async () => {
    fetchMock.mockRejectedValue(new Error("HTTP 500"))
    expect(await getPopularSearches()).toBeNull()
    fetchMock.mockRejectedValue(new DOMException("t", "TimeoutError"))
    expect(await getPopularSearches()).toBeNull()
    fetchMock.mockResolvedValue({})
    expect(await getPopularSearches()).toBeNull()
  })
})

describe("getTrendingProducts", () => {
  beforeEach(() => vi.resetAllMocks())

  it("returns products and requests limit 8", async () => {
    const products = [{ id: "p1", title: "T", handle: "t", thumbnail: null }]
    fetchMock.mockResolvedValue({ products })
    expect(await getTrendingProducts()).toEqual(products)
    const [path, init] = fetchMock.mock.calls[0]
    expect(path).toBe("/store/search/trending")
    expect(init.query).toEqual({ limit: 8 })
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.next).toEqual({ revalidate: 300 })
  })

  it("returns null on failure, timeout or bad shape", async () => {
    fetchMock.mockRejectedValue(new Error("HTTP 503"))
    expect(await getTrendingProducts()).toBeNull()
    fetchMock.mockRejectedValue(new DOMException("t", "AbortError"))
    expect(await getTrendingProducts()).toBeNull()
    fetchMock.mockResolvedValue({ products: "x" })
    expect(await getTrendingProducts()).toBeNull()
  })
})
