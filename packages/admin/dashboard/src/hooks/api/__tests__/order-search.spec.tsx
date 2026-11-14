// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }))

vi.mock("../../../lib/client", () => ({
  sdk: { client: { fetch: (...a: any[]) => mockFetch(...a) } },
}))

import { useOrderEvents } from "../order-events"
import { useOrderSearch } from "../order-search"

const makeWrapper = () => {
  const client = new QueryClient()
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return Wrapper
}

afterEach(() => mockFetch.mockReset())

describe("useOrderSearch", () => {
  it.each([{}, { q: "" }, { q: "   " }, { q: "a" }, { country: "USA" }])(
    "is disabled with orderIds null for %j",
    (params) => {
      const { result } = renderHook(() => useOrderSearch(params), {
        wrapper: makeWrapper(),
      })
      expect(mockFetch).not.toHaveBeenCalled()
      expect(result.current.orderIds).toBeNull()
      expect(result.current.isLoading).toBe(false)
      expect(result.current.truncated).toBe(false)
    }
  )

  it("sends only the normalised active params", async () => {
    mockFetch.mockResolvedValue({ order_ids: ["o1", "o2"], truncated: true })
    const { result } = renderHook(
      () => useOrderSearch({ q: "  smith ", sku: " ", country: "us" }),
      { wrapper: makeWrapper() }
    )
    await waitFor(() => expect(result.current.orderIds).toEqual(["o1", "o2"]))
    expect(mockFetch).toHaveBeenCalledWith("/admin/order-search", {
      query: { q: "smith", country: "US" },
    })
    expect(result.current.truncated).toBe(true)
  })

  it("reports errors without retrying", async () => {
    mockFetch.mockRejectedValue(new Error("boom"))
    const { result } = renderHook(() => useOrderSearch({ sku: "ABC" }), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(result.current.orderIds).toBeNull()
  })
})

describe("useOrderEvents", () => {
  it("fetches the events of an order", async () => {
    mockFetch.mockResolvedValue({ events: [{ id: "e1" }] })
    const { result } = renderHook(() => useOrderEvents("o1"), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.events).toHaveLength(1))
    expect(mockFetch).toHaveBeenCalledWith("/admin/orders/o1/events")
  })

  it("does not fetch without an order id", () => {
    renderHook(() => useOrderEvents(undefined), { wrapper: makeWrapper() })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
