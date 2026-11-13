// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }))

vi.mock("../../../lib/client", () => ({
  sdk: { client: { fetch: (...args: any[]) => mockFetch(...args) } },
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
import {
  marketplaceConnectionsQueryKeys,
  useCreateMarketplaceSalesChannel,
  useDisconnectMarketplaceConnection,
  useLinkMarketplaceConnection,
  useMarketplaceConnection,
  useSaveMarketplaceConnection,
  useTestMarketplaceConnection,
} from "../marketplace-connections"

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)

afterEach(() => {
  queryClient.clear()
  mockFetch.mockReset()
})

describe("marketplace connection hooks", () => {
  it("creates a channel with a connection (name based) and invalidates the connection queries", async () => {
    mockFetch.mockResolvedValue({
      sales_channel: { id: "sc_1", name: "A" },
      connection_status: "connected",
    })
    const invalidate = vi.spyOn(queryClient, "invalidateQueries")
    const { result } = renderHook(() => useCreateMarketplaceSalesChannel(), {
      wrapper,
    })

    await act(async () => {
      await result.current.mutateAsync({
        marketplace: "shopify",
        name: "A",
        shop_domain: "a.myshopify.com",
      })
    })

    expect(mockFetch).toHaveBeenCalledWith("/admin/marketplace-connections", {
      method: "POST",
      body: {
        marketplace: "shopify",
        name: "A",
        shop_domain: "a.myshopify.com",
      },
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: marketplaceConnectionsQueryKeys.all,
    })
  })

  it("attaches to an existing channel (sales_channel_id based)", async () => {
    mockFetch.mockResolvedValue({ sales_channel: { id: "sc_9", name: "B" } })
    const { result } = renderHook(() => useCreateMarketplaceSalesChannel(), {
      wrapper,
    })
    await act(async () => {
      await result.current.mutateAsync({
        marketplace: "amazon",
        sales_channel_id: "sc_9",
      })
    })
    expect(mockFetch.mock.calls[0][1].body).toEqual({
      marketplace: "amazon",
      sales_channel_id: "sc_9",
    })
  })

  it("useMarketplaceConnection queries the list filtered by channel and returns the single connection", async () => {
    mockFetch.mockResolvedValue({ connections: [{ id: "mc_1" }] })
    const { result } = renderHook(() => useMarketplaceConnection("sc_1"), {
      wrapper,
    })
    await waitFor(() =>
      expect(result.current.connection).toEqual({ id: "mc_1" })
    )
    expect(mockFetch).toHaveBeenCalledWith("/admin/marketplace-connections", {
      query: { sales_channel_id: "sc_1" },
    })
  })

  it("useMarketplaceConnection returns null when the channel has none", async () => {
    mockFetch.mockResolvedValue({ connections: [] })
    const { result } = renderHook(() => useMarketplaceConnection("sc_2"), {
      wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.connection).toBeNull()
  })

  it("save, test, link and disconnect hit the per-connection routes", async () => {
    mockFetch.mockResolvedValue({ connection: { sales_channel_id: "sc_1" } })
    const { result } = renderHook(
      () => ({
        save: useSaveMarketplaceConnection("mc_1"),
        test: useTestMarketplaceConnection("mc_1"),
        link: useLinkMarketplaceConnection("mc_1"),
        disconnect: useDisconnectMarketplaceConnection("mc_1"),
      }),
      { wrapper }
    )

    await act(async () => {
      await result.current.save.mutateAsync({ access_token: "t" })
      await result.current.test.mutateAsync()
      await result.current.link.mutateAsync()
      await result.current.disconnect.mutateAsync()
    })

    expect(mockFetch.mock.calls).toEqual([
      [
        "/admin/marketplace-connections/mc_1",
        { method: "POST", body: { access_token: "t" } },
      ],
      ["/admin/marketplace-connections/mc_1/test", { method: "POST" }],
      ["/admin/marketplace-connections/mc_1/link", { method: "POST" }],
      ["/admin/marketplace-connections/mc_1", { method: "DELETE" }],
    ])
  })
})
