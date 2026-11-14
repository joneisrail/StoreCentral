// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }))

vi.mock("../../../lib/client", () => ({
  sdk: { client: { fetch: (...a: any[]) => mockFetch(...a) } },
}))
vi.mock("../../../lib/query-client", async () => {
  const { QueryClient } = await vi.importActual<
    typeof import("@tanstack/react-query")
  >("@tanstack/react-query")
  return { queryClient: new QueryClient() }
})

import { queryClient } from "../../../lib/query-client"
import { useMarkOrderShipped, useVoidOrderLabel } from "../order-shipping"

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)

afterEach(() => {
  vi.restoreAllMocks()
  mockFetch.mockReset()
})

const keys = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.map((c: any[]) => c[0].queryKey)

describe("order shipping mutations", () => {
  it("void posts with no body and invalidates lists, detail and counts", async () => {
    mockFetch.mockResolvedValue({ order_id: "o1", voided: [] })
    const spy = vi.spyOn(queryClient, "invalidateQueries")
    const { result } = renderHook(() => useVoidOrderLabel(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ id: "o1" })
    })
    expect(mockFetch).toHaveBeenCalledWith("/admin/orders/o1/void-label", {
      method: "POST",
    })
    const k = keys(spy)
    expect(k).toContainEqual(["orders", "list"])
    expect(k).toContainEqual(["orders", "detail", "o1"])
    expect(k).toContainEqual(["order-view-counts"])
  })

  it("mark shipped posts the body and invalidates the same queries", async () => {
    mockFetch.mockResolvedValue({ order_id: "o1", fulfillment_id: "f1" })
    const spy = vi.spyOn(queryClient, "invalidateQueries")
    const { result } = renderHook(() => useMarkOrderShipped(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({
        id: "o1",
        carrier: "UPS",
        tracking_number: "1Z",
      })
    })
    expect(mockFetch).toHaveBeenCalledWith("/admin/orders/o1/mark-shipped", {
      method: "POST",
      body: { carrier: "UPS", tracking_number: "1Z" },
    })
    const k = keys(spy)
    expect(k).toContainEqual(["orders", "list"])
    expect(k).toContainEqual(["orders", "detail", "o1"])
    expect(k).toContainEqual(["order-view-counts"])
  })
})
