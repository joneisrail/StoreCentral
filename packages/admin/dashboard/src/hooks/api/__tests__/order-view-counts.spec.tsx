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
      if (q.tag_id === "tag_1" && q.limit === 500) {
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
