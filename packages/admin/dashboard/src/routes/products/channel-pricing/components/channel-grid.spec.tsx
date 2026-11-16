// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const { mockUseChannelOffers } = vi.hoisted(() => ({
  mockUseChannelOffers: vi.fn(),
}))

vi.mock("../../../../hooks/api/channel-offers", () => ({
  useChannelOffers: (params: unknown) => mockUseChannelOffers(params),
}))

import { ChannelGrid } from "./channel-grid"

const cell = (over: Record<string, unknown> = {}) => ({
  price: 1000,
  effective_price: 1000,
  stock: 3,
  sync_state: null,
  last_synced_at: null,
  last_error: null,
  has_connection: false,
  ...over,
})

const data = {
  rows: [
    {
      variant_id: "v1",
      product_id: "p1",
      product_title: "Rose Oil",
      variant_title: "10ml",
      sku: "RO-10",
      base_price: 1200,
      available: 10,
      unallocated: 4,
      channels: {
        ch_ebay: cell(),
        ch_web: cell({ price: null, effective_price: 1200, stock: 3 }),
      },
    },
  ],
  channels: [
    { id: "ch_ebay", name: "eBay", kind: "marketplace", has_connection: true },
    { id: "ch_web", name: "Webstore", kind: "web", has_connection: false },
  ],
  count: 1,
  truncated: false,
}

const ok = (over: Record<string, unknown> = {}) =>
  mockUseChannelOffers.mockReturnValue({
    data: { ...data, ...over },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })

const renderAt = (path = "/") => {
  const router = createMemoryRouter([{ path: "*", element: <ChannelGrid /> }], {
    initialEntries: [path],
  })
  render(<RouterProvider router={router} />)
  return router
}

const groupNames = () =>
  screen
    .getAllByRole("columnheader")
    .filter((h) => h.hasAttribute("data-channel-group"))
    .map((h) => h.textContent)

beforeEach(() => ok())
afterEach(() => {
  cleanup()
  mockUseChannelOffers.mockReset()
  vi.useRealTimers()
})

describe("ChannelGrid", () => {
  it("renders a column group per channel in response order", () => {
    renderAt()
    expect(groupNames()).toEqual(["eBay", "Webstore"])
    expect(screen.getAllByText("Rose Oil")).toHaveLength(1)
  })

  it("defaults to total ascending, limit 50, offset 0", () => {
    renderAt()
    expect(mockUseChannelOffers).toHaveBeenLastCalledWith({
      q: undefined,
      order: "total",
      limit: 50,
      offset: 0,
    })
  })

  it("removes a channel's columns when its chip is toggled off", () => {
    renderAt()
    fireEvent.click(screen.getByRole("button", { name: "Webstore" }))
    expect(groupNames()).toEqual(["eBay"])
  })

  it("restores hidden channels from the channels URL param", () => {
    renderAt("/?channels=ch_ebay")
    expect(groupNames()).toEqual(["eBay"])
  })

  it("marks the base price fallback", () => {
    renderAt()
    expect(screen.getAllByTestId("price-fallback")).toHaveLength(1)
  })

  it("sends the debounced search term as q", () => {
    vi.useFakeTimers()
    renderAt()
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "rose" },
    })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(mockUseChannelOffers).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: "rose", offset: 0 })
    )
  })

  it("sends the chosen sort as order, with - for descending", () => {
    renderAt()
    fireEvent.change(screen.getByLabelText("channelPricing.sortBy"), {
      target: { value: "ch_ebay:stock" },
    })
    expect(mockUseChannelOffers).toHaveBeenLastCalledWith(
      expect.objectContaining({ order: "ch_ebay:stock" })
    )
    fireEvent.change(screen.getByLabelText("channelPricing.direction"), {
      target: { value: "desc" },
    })
    expect(mockUseChannelOffers).toHaveBeenLastCalledWith(
      expect.objectContaining({ order: "-ch_ebay:stock" })
    )
  })

  it("shows the empty state", () => {
    ok({ rows: [], count: 0 })
    renderAt()
    expect(screen.getByText("channelPricing.empty")).toBeTruthy()
  })

  it("shows an error state with retry", () => {
    const refetch = vi.fn()
    mockUseChannelOffers.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    })
    renderAt()
    fireEvent.click(screen.getByRole("button", { name: "actions.retry" }))
    expect(refetch).toHaveBeenCalled()
  })

  it("never sends an unknown order and says the sort was reset", () => {
    renderAt("/?order=-ch_deleted:stock")
    expect(mockUseChannelOffers).toHaveBeenLastCalledWith(
      expect.objectContaining({ order: "total" })
    )
    expect(screen.getByText("channelPricing.sortReset")).toBeTruthy()
  })

  it("sends a channel order once the channel is known", () => {
    renderAt("/?order=-ch_ebay:stock")
    // no manual re-render: the loaded channel list alone must trigger it
    expect(mockUseChannelOffers).toHaveBeenCalledWith(
      expect.objectContaining({ order: "total" })
    )
    expect(mockUseChannelOffers).toHaveBeenLastCalledWith(
      expect.objectContaining({ order: "-ch_ebay:stock" })
    )
  })

  it("offers Reset sort in the error state and clears the order", () => {
    mockUseChannelOffers.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    })
    const router = renderAt("/?order=name")
    fireEvent.click(
      screen.getByRole("button", { name: "channelPricing.resetSort" })
    )
    expect(router.state.location.search).toBe("")
  })

  it("a stale channel order that still 400s offers Reset sort", () => {
    mockUseChannelOffers.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    })
    const router = renderAt("/?order=-ch_gone:price")
    fireEvent.click(
      screen.getByRole("button", { name: "channelPricing.resetSort" })
    )
    expect(router.state.location.search).toBe("")
  })

  it("clears a stale offset when there are no results at all", () => {
    ok({ rows: [], count: 0 })
    const router = renderAt("/?offset=50")
    expect(router.state.location.search).toBe("")
  })

  it("steps back when the offset is beyond the last page", () => {
    ok({ rows: [], count: 120 })
    const router = renderAt("/?offset=500")
    expect(router.state.location.search).toBe("?offset=100")
  })

  it("resyncs the search box when q changes in the URL", () => {
    const router = renderAt("/?q=rose")
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe(
      "rose"
    )
    act(() => {
      router.navigate("/?q=musk")
    })
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe(
      "musk"
    )
  })

  it("shows the truncated notice", () => {
    ok({ truncated: true })
    renderAt()
    expect(screen.getByText("channelPricing.truncated")).toBeTruthy()
  })
})
