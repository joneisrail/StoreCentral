// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

const { mockUseOrderViewCounts } = vi.hoisted(() => ({
  mockUseOrderViewCounts: vi.fn(),
}))

vi.mock("../../../../../hooks/api/order-view-counts", () => ({
  useOrderViewCounts: () => mockUseOrderViewCounts(),
}))

import { getOrderListView, OrderListTabs } from "./order-list-tabs"

afterEach(() => {
  cleanup()
  mockUseOrderViewCounts.mockReset()
})

const setCounts = (counts: Record<string, number | null>) => {
  mockUseOrderViewCounts.mockReturnValue({
    counts: {
      all: null,
      "ready-to-ship": null,
      shipped: null,
      "awaiting-payment": null,
      "on-hold": null,
      cancelled: null,
      ...counts,
    },
    isLoading: false,
    refetch: vi.fn(),
  })
}

const renderTabsAt = (path: string) => {
  const router = createMemoryRouter(
    [{ path: "*", element: <OrderListTabs /> }],
    { initialEntries: [path] }
  )
  render(<RouterProvider router={router} />)
  return router
}

describe("OrderListTabs", () => {
  it("renders six tabs with counts and a dash for a failed count", () => {
    setCounts({
      all: 12,
      "ready-to-ship": 4,
      shipped: 0,
      "awaiting-payment": 3,
      "on-hold": null,
      cancelled: 9,
    })

    renderTabsAt("/orders")

    const tabs = screen.getAllByRole("tab")
    expect(tabs.map((t) => t.textContent)).toEqual([
      "orders.list.tabs.all12",
      "orders.list.tabs.readyToShip4",
      "orders.list.tabs.shipped0",
      "orders.list.tabs.awaitingPayment3",
      "orders.list.tabs.onHold–",
      "orders.list.tabs.cancelled9",
    ])
  })

  it("shows a dash for every count while counts are unavailable", () => {
    setCounts({})

    renderTabsAt("/orders")

    expect(screen.getByTestId("order-tab-count-all").textContent).toBe("–")
  })

  it("links keep other query params and drop view for All", () => {
    setCounts({})

    renderTabsAt("/orders?view=on-hold&hld_offset=20&q=abc")

    const href = (name: string) =>
      screen.getByRole("tab", { name: new RegExp(name) }).getAttribute("href")

    expect(href("tabs.all")).toBe("/orders?hld_offset=20&q=abc")
    expect(href("tabs.readyToShip")).toBe(
      "/orders?view=ready-to-ship&hld_offset=20&q=abc"
    )
    expect(href("tabs.awaitingPayment")).toBe(
      "/orders?view=awaiting-payment&hld_offset=20&q=abc"
    )
    expect(href("tabs.cancelled")).toBe(
      "/orders?view=cancelled&hld_offset=20&q=abc"
    )
  })

  it("marks the tab for the current view as active", () => {
    setCounts({})

    renderTabsAt("/orders?view=cancelled")

    expect(
      screen
        .getByRole("tab", { name: /tabs\.cancelled/ })
        .getAttribute("data-state")
    ).toBe("active")
  })
})

describe("getOrderListView", () => {
  it("accepts every view", () => {
    for (const view of [
      "ready-to-ship",
      "shipped",
      "awaiting-payment",
      "on-hold",
      "cancelled",
    ]) {
      expect(getOrderListView(new URLSearchParams({ view }))).toBe(view)
    }
  })

  it("unknown ?view= falls back to All", () => {
    expect(getOrderListView(new URLSearchParams("view=bogus"))).toBe("all")
    expect(getOrderListView(new URLSearchParams("view=all"))).toBe("all")
    expect(getOrderListView(new URLSearchParams(""))).toBe("all")
  })
})
