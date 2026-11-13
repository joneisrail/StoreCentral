// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }))

vi.mock("../../../lib/client", () => ({
  sdk: {
    client: { fetch: (...a: any[]) => mockFetch(...a) },
    admin: { order: { list: vi.fn() }, orderTags: { list: vi.fn() } },
  },
}))
vi.mock("../../../lib/query-client", async () => {
  const { QueryClient } = await vi.importActual<
    typeof import("@tanstack/react-query")
  >("@tanstack/react-query")
  return { queryClient: new QueryClient() }
})

import { queryClient } from "../../../lib/query-client"
import { useHoldOrder, useReleaseOrder } from "../order-holds"

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)

afterEach(() => {
  vi.restoreAllMocks()
  mockFetch.mockReset()
})

const invalidatedKeys = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.map((c: any[]) => c[0].queryKey)

describe("hold/release mutations", () => {
  it("hold posts the reason and invalidates lists, counts, held ids and tags", async () => {
    mockFetch.mockResolvedValue({ order_id: "o1", on_hold: true })
    const spy = vi.spyOn(queryClient, "invalidateQueries")

    const { result } = renderHook(() => useHoldOrder(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ id: "o1", reason: "fraud" })
    })

    expect(mockFetch).toHaveBeenCalledWith("/admin/orders/o1/hold", {
      method: "POST",
      body: { reason: "fraud" },
    })
    const keys = invalidatedKeys(spy)
    expect(keys).toContainEqual(["orders", "list"])
    expect(keys).toContainEqual(["order-view-counts"])
    expect(keys).toContainEqual(["order-held-ids"])
    expect(keys).toContainEqual(["order-tags"])
  })

  it("release posts with no body and invalidates the same queries", async () => {
    mockFetch.mockResolvedValue({ order_id: "o1", on_hold: false })
    const spy = vi.spyOn(queryClient, "invalidateQueries")

    const { result } = renderHook(() => useReleaseOrder(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ id: "o1" })
    })

    expect(mockFetch).toHaveBeenCalledWith("/admin/orders/o1/release", {
      method: "POST",
    })
    const keys = invalidatedKeys(spy)
    expect(keys).toContainEqual(["orders", "list"])
    expect(keys).toContainEqual(["order-view-counts"])
    expect(keys).toContainEqual(["order-held-ids"])
    expect(keys).toContainEqual(["order-tags"])
  })
})
