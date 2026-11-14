// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const sdkMock = vi.hoisted(() => ({
  bulkFulfill: vi.fn(),
  createFulfillment: vi.fn(),
  createShipment: vi.fn(),
  cancelFulfillment: vi.fn(),
  markAsDelivered: vi.fn(),
}))

vi.mock("../../../lib/client", () => ({
  sdk: {
    client: { fetch: vi.fn() },
    admin: { order: sdkMock },
  },
}))
vi.mock("../../../lib/query-client", async () => {
  const { QueryClient } = await vi.importActual<
    typeof import("@tanstack/react-query")
  >("@tanstack/react-query")
  return { queryClient: new QueryClient() }
})

import { queryClient } from "../../../lib/query-client"
import {
  useBulkFulfillOrders,
  useCancelOrderFulfillment,
  useCreateOrderFulfillment,
  useCreateOrderShipment,
  useMarkOrderFulfillmentAsDelivered,
} from "../orders"
import { ORDER_VIEW_COUNTS_QUERY_KEY } from "../order-query-keys"

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)

afterEach(() => {
  vi.restoreAllMocks()
  Object.values(sdkMock).forEach((m) => m.mockReset())
  queryClient.clear()
})

const invalidatedKeys = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.map((c: any[]) => JSON.stringify(c[0]?.queryKey))

describe("fulfillment mutations refresh the tab counts", () => {
  const cases: [string, () => any, () => void][] = [
    [
      "useBulkFulfillOrders",
      () => useBulkFulfillOrders(),
      () => sdkMock.bulkFulfill.mockResolvedValue({ succeeded: [], failed: [] }),
    ],
    [
      "useCreateOrderFulfillment",
      () => useCreateOrderFulfillment("order_1"),
      () => sdkMock.createFulfillment.mockResolvedValue({}),
    ],
    [
      "useCreateOrderShipment",
      () => useCreateOrderShipment("order_1", "ful_1"),
      () => sdkMock.createShipment.mockResolvedValue({}),
    ],
    [
      "useCancelOrderFulfillment",
      () => useCancelOrderFulfillment("order_1", "ful_1"),
      () => sdkMock.cancelFulfillment.mockResolvedValue({}),
    ],
    [
      "useMarkOrderFulfillmentAsDelivered",
      () => useMarkOrderFulfillmentAsDelivered("order_1", "ful_1"),
      () => sdkMock.markAsDelivered.mockResolvedValue({}),
    ],
  ]

  it.each(cases)("%s invalidates the view counts", async (_n, hook, arrange) => {
    arrange()
    const spy = vi.spyOn(queryClient, "invalidateQueries")
    const { result } = renderHook(hook, { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ fulfillments: [], items: [] } as any)
    })

    expect(invalidatedKeys(spy)).toContain(
      JSON.stringify([ORDER_VIEW_COUNTS_QUERY_KEY])
    )
  })
})
