// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const { mockFetch, mockBulkFulfill } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockBulkFulfill: vi.fn(),
}))

// `lib/client` and `lib/query-client` read Vite build-time defines that
// don't exist under a plain test - replaced with a fake SDK and a real,
// fresh QueryClient (the hooks import that singleton directly).
vi.mock("../../../lib/client", () => ({
  sdk: {
    client: { fetch: (...args: any[]) => mockFetch(...args) },
    admin: { order: { bulkFulfill: (...args: any[]) => mockBulkFulfill(...args) } },
  },
}))
vi.mock("../../../lib/query-client", async () => {
  const { QueryClient } = await vi.importActual<
    typeof import("@tanstack/react-query")
  >("@tanstack/react-query")
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 90000 } },
    }),
  }
})

import { queryClient } from "../../../lib/query-client"
import { useBulkFulfillOrders, useOrderCarrierRates } from "../orders"

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)

const parcel = { weight: 16 }

afterEach(() => {
  queryClient.clear()
  mockFetch.mockReset()
  mockBulkFulfill.mockReset()
})

describe("carrier-rates quotes vs. order mutations", () => {
  it("fulfilling one order doesn't re-quote (and so doesn't reset the picked rate of) other visible rows", async () => {
    let quoteCounter = 0
    mockFetch.mockImplementation(async (url: string) => ({
      shipment_id: `shp_${++quoteCounter}`,
      rates: [],
      url,
    }))
    mockBulkFulfill.mockResolvedValue({ succeeded: ["order_a"], failed: [] })

    const { result } = renderHook(
      () => ({
        quoteA: useOrderCarrierRates("order_a", {
          location_id: "sloc_1",
          parcel,
        }),
        quoteB: useOrderCarrierRates("order_b", {
          location_id: "sloc_1",
          parcel,
        }),
        fulfill: useBulkFulfillOrders(),
      }),
      { wrapper }
    )

    await waitFor(() => {
      expect(result.current.quoteA.data).toBeDefined()
      expect(result.current.quoteB.data).toBeDefined()
    })
    const quoteBBefore = result.current.quoteB.data

    await act(async () => {
      await result.current.fulfill.mutateAsync({
        fulfillments: [
          {
            order_id: "order_a",
            location_id: "sloc_1",
            shipment_id: "shp_1",
            rate_id: "rate_1",
          },
        ],
      })
    })

    // order_a's quote (its shipment was just bought) is re-quoted...
    await waitFor(() =>
      expect(
        mockFetch.mock.calls.filter(([url]) => url.includes("order_a"))
      ).toHaveLength(2)
    )
    // ...but order_b - not part of this fulfill - keeps its quote untouched.
    expect(
      mockFetch.mock.calls.filter(([url]) => url.includes("order_b"))
    ).toHaveLength(1)
    expect(result.current.quoteB.data).toBe(quoteBBefore)
  })

  it("never requests a quote when no ship-from location resolves", async () => {
    const { result } = renderHook(
      () =>
        useOrderCarrierRates("order_a", { location_id: null, parcel }),
      { wrapper }
    )

    // Give any (wrongly) enabled query a chance to fire.
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(mockFetch).not.toHaveBeenCalled()
    expect(result.current.fetchStatus).toBe("idle")
  })
})
