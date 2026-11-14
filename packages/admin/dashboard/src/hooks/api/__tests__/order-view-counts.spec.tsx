// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const { mockList, mockTagList } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockTagList: vi.fn(),
}))

vi.mock("../../../lib/client", () => ({
  sdk: {
    client: { fetch: vi.fn() },
    admin: {
      order: { list: (...a: any[]) => mockList(...a) },
      orderTags: { list: (...a: any[]) => mockTagList(...a) },
    },
  },
}))
vi.mock("../../../lib/query-client", async () => {
  const { QueryClient } = await vi.importActual<
    typeof import("@tanstack/react-query")
  >("@tanstack/react-query")
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  }
})

import { queryClient } from "../../../lib/query-client"
import { useHeldOrderIds } from "../order-holds"
import { useOrderViewCounts } from "../order-view-counts"

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)

afterEach(() => {
  queryClient.clear()
  mockList.mockReset()
  mockTagList.mockReset()
})

describe("useOrderViewCounts", () => {
  it("returns a count per tab and null for a failed tab", async () => {
    mockTagList.mockResolvedValue({
      order_tags: [{ id: "tag_1", value: "On hold" }],
    })
    mockList.mockImplementation(async (q: any) => {
      if (q.status === "canceled") {
        throw new Error("boom")
      }
      if (q.tag_id === "tag_1" && q.limit === 200) {
        return { orders: [{ id: "o1" }], count: 1 }
      }
      if (q.tag_id === "tag_1") {
        return { orders: [], count: 1 }
      }
      if (q.fulfillment_status?.includes("shipped")) {
        return { orders: [], count: 7 }
      }
      return { orders: [], count: 3 }
    })

    const { result } = renderHook(() => useOrderViewCounts(), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.counts).toEqual({
      all: 3,
      "ready-to-ship": 3,
      shipped: 7,
      "awaiting-payment": 3,
      "on-hold": 1,
      cancelled: null,
    })
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({
        id: { $nin: ["o1"] },
        limit: 1,
        fields: "id",
        payment_status: ["captured", "partially_captured"],
      })
    )
  })
})

describe("exclusion lookup failures", () => {
  it("nulls the dependent counts when the hold tag lookup fails", async () => {
    mockTagList.mockRejectedValue(new Error("tag boom"))
    mockList.mockResolvedValue({ orders: [], count: 4 })

    const { result } = renderHook(() => useOrderViewCounts(), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await waitFor(() =>
      expect(result.current.counts["ready-to-ship"]).toBeNull()
    )

    expect(result.current.counts).toEqual({
      all: 4,
      "ready-to-ship": null,
      shipped: 4,
      "awaiting-payment": null,
      "on-hold": null,
      cancelled: 4,
    })
    // No dependent view was ever requested without its exclusion.
    expect(
      mockList.mock.calls.some(([q]: any[]) => q.payment_status !== undefined)
    ).toBe(false)
  })

  it("nulls ready-to-ship and awaiting-payment (not on-hold) when held ids fail", async () => {
    mockTagList.mockResolvedValue({
      order_tags: [{ id: "tag_1", value: "On hold" }],
    })
    mockList.mockImplementation(async (q: any) => {
      if (q.tag_id === "tag_1" && q.limit === 200) {
        throw new Error("held boom")
      }
      return { orders: [], count: 2 }
    })

    const { result } = renderHook(() => useOrderViewCounts(), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await waitFor(() => expect(result.current.counts["on-hold"]).toBe(2))

    expect(result.current.counts["ready-to-ship"]).toBeNull()
    expect(result.current.counts["awaiting-payment"]).toBeNull()
  })
})

describe("useHeldOrderIds", () => {
  it("reports isError when the tag lookup fails", async () => {
    mockTagList.mockRejectedValue(new Error("tag boom"))

    const { result } = renderHook(() => useHeldOrderIds(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.ids).toEqual([])
  })

  it("reports isError when more orders are held than the 200 fetched ids", async () => {
    mockTagList.mockResolvedValue({
      order_tags: [{ id: "tag_1", value: "On hold" }],
    })
    mockList.mockResolvedValue({ orders: [{ id: "o1" }], count: 201 })

    const { result } = renderHook(() => useHeldOrderIds(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it("is not an error when every held id was fetched", async () => {
    mockTagList.mockResolvedValue({
      order_tags: [{ id: "tag_1", value: "On hold" }],
    })
    mockList.mockResolvedValue({ orders: [{ id: "o1" }], count: 1 })

    const { result } = renderHook(() => useHeldOrderIds(), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isError).toBe(false)
    expect(result.current.ids).toEqual(["o1"])
  })
})
