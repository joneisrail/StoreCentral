// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook } from "@testing-library/react"
import { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }))

vi.mock("../../../lib/client", () => ({
  sdk: { client: { fetch: (...args: any[]) => mockFetch(...args) } },
}))

import {
  CHANNEL_OFFERS_POLL_MS,
  ChannelOffersResponse,
  hasPendingConnectedCell,
  useChannelOffers,
} from "../channel-offers"

const cell = (over: Record<string, unknown> = {}) => ({
  price: null,
  effective_price: 1,
  stock: 1,
  sync_state: "synced",
  last_synced_at: null,
  last_error: null,
  has_connection: true,
  ...over,
})

const response = (channels: Record<string, any>): ChannelOffersResponse => ({
  rows: [
    {
      variant_id: "v1",
      product_id: "p1",
      product_title: "T",
      variant_title: null,
      sku: null,
      base_price: 1,
      available: 1,
      unallocated: 0,
      channels,
    },
  ],
  channels: [],
  count: 1,
  truncated: false,
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  mockFetch.mockReset()
})

const setup = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  renderHook(() => useChannelOffers({ limit: 50 }), { wrapper })
  return client
}

describe("hasPendingConnectedCell", () => {
  it("is true only for a pending cell of a connected channel", () => {
    expect(
      hasPendingConnectedCell(response({ a: cell({ sync_state: "pending" }) }))
    ).toBe(true)
    expect(
      hasPendingConnectedCell(
        response({ a: cell({ sync_state: "pending", has_connection: false }) })
      )
    ).toBe(false)
    expect(hasPendingConnectedCell(response({ a: cell() }))).toBe(false)
    expect(hasPendingConnectedCell(undefined)).toBe(false)
  })
})

describe("useChannelOffers polling", () => {
  it("refetches every 10s while a connected cell is pending and stops once synced", async () => {
    vi.useFakeTimers()
    mockFetch
      .mockResolvedValueOnce(response({ a: cell({ sync_state: "pending" }) }))
      .mockResolvedValue(response({ a: cell() }))
    const client = setup()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHANNEL_OFFERS_POLL_MS)
    })
    expect(mockFetch).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHANNEL_OFFERS_POLL_MS * 3)
    })
    expect(mockFetch).toHaveBeenCalledTimes(2)
    client.clear()
  })

  it("does not poll when no connected cell is pending", async () => {
    vi.useFakeTimers()
    mockFetch.mockResolvedValue(
      response({ w: cell({ sync_state: "pending", has_connection: false }) })
    )
    const client = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHANNEL_OFFERS_POLL_MS * 3)
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    client.clear()
  })
})
