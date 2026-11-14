// @vitest-environment jsdom
import { TooltipProvider } from "@medusajs/ui"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentType, ReactElement } from "react"
import { MemoryRouter, useLocation } from "react-router-dom"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}))

const { mockUseOrders, mockUseOrderSearch } = vi.hoisted(() => ({
  mockUseOrders: vi.fn(),
  mockUseOrderSearch: vi.fn(),
}))

vi.mock("../../../../../../lib/client", () => ({ sdk: {} }))
vi.mock("../../../../../../hooks/api/orders", () => ({
  useOrders: (...args: unknown[]) => mockUseOrders(...args),
}))
vi.mock("../../../../../../hooks/api/order-search", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../../../hooks/api/order-search")
  >()),
  useOrderSearch: (...args: unknown[]) => mockUseOrderSearch(...args),
}))
vi.mock("../../../../../../hooks/api/order-holds", () => ({
  useHoldTag: () => ({ tagId: "tag_hold", isLoading: false, isError: false }),
  useHeldOrderIds: () => ({
    ids: ["order_held"],
    isLoading: false,
    isError: false,
  }),
}))
vi.mock("../../../../../../hooks/api/regions", () => ({
  useRegions: () => ({ regions: [] }),
}))
vi.mock("../../../../../../hooks/api/sales-channels", () => ({
  useSalesChannels: () => ({ sales_channels: [{ id: "sc_1", name: "Web" }] }),
}))
vi.mock("../../../../../../hooks/api/order-tags", () => ({
  useOrderTags: () => ({ order_tags: [{ id: "tag_1", value: "VIP" }] }),
}))
vi.mock("../../../../../../hooks/api/stock-locations", () => ({
  useStockLocations: () => ({ stock_locations: [] }),
}))
vi.mock("../../../../../../hooks/use-date", () => ({
  useDate: () => ({ getFullDate: () => "date", getRelativeDate: () => "date" }),
}))
// Row actions pull in hold/cancel/shipping hooks; they have their own specs.
vi.mock("./row-actions-menu", () => {
  const column = { id: "actions", header: "", cell: () => null }
  return {
    ACTIVE_ROW_ACTIONS_COLUMN: column,
    HELD_ROW_ACTIONS_COLUMN: column,
    SHIPPED_ROW_ACTIONS_COLUMN: column,
  }
})

import { AwaitingPaymentTable } from "./awaiting-payment-table"
import { CancelledTable } from "./cancelled-table"
import { OnHoldTable } from "./on-hold-table"
import { ShippedTable } from "./shipped-table"

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", RO)
  Element.prototype.scrollIntoView = vi.fn()
  if (!Element.prototype.scroll) {
    Element.prototype.scroll = vi.fn()
  }
})

const inactive = {
  orderIds: null as string[] | null,
  truncated: false,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}

const setOrders = (orders: unknown[], count = orders.length) =>
  mockUseOrders.mockReturnValue({
    orders,
    count,
    isLoading: false,
    isError: false,
    error: undefined,
  })

const order = {
  id: "order_1",
  display_id: 4242,
  created_at: "2024-01-01T00:00:00.000Z",
  currency_code: "usd",
  total: 1000,
  payment_status: "captured",
  fulfillment_status: "shipped",
  customer: null,
  fulfillments: [],
}

afterEach(() => {
  cleanup()
  mockUseOrders.mockReset()
  mockUseOrderSearch.mockReset()
})

const LocationProbe = () => (
  <output data-testid="search">{useLocation().search}</output>
)

type Case = {
  name: string
  Table: ComponentType
  prefix: string
  /** The request params the tab sends with no user criteria. */
  baseParams: Record<string, unknown>
  /** URL criteria that must narrow the tab, and the resulting params. */
  narrowUrl: string
  narrowed: Record<string, unknown>
}

const cases: Case[] = [
  {
    name: "Awaiting Payment",
    Table: AwaitingPaymentTable,
    prefix: "awp",
    baseParams: {
      payment_status: ["not_paid", "awaiting"],
      status: { $nin: ["canceled"] },
      id: { $nin: ["order_held"] },
    },
    narrowUrl: "awp_f_payment_status=awaiting,captured",
    narrowed: { payment_status: ["awaiting"] },
  },
  {
    name: "On Hold",
    Table: OnHoldTable,
    prefix: "hld",
    baseParams: { tag_id: "tag_hold", status: { $nin: ["canceled"] } },
    narrowUrl: "hld_f_sales_channel_id=sc_1",
    narrowed: {
      sales_channel_id: ["sc_1"],
      tag_id: "tag_hold",
      status: { $nin: ["canceled"] },
    },
  },
  {
    name: "Cancelled",
    Table: CancelledTable,
    prefix: "cxl",
    baseParams: { status: "canceled" },
    narrowUrl: "cxl_f_sales_channel_id=sc_1",
    narrowed: { sales_channel_id: ["sc_1"], status: "canceled" },
  },
  {
    name: "Shipped",
    Table: ShippedTable,
    prefix: "shp",
    baseParams: {
      fulfillment_status: [
        "fulfilled",
        "shipped",
        "partially_shipped",
        "partially_delivered",
        "delivered",
      ],
    },
    narrowUrl: "shp_f_fulfillment_status=shipped,not_fulfilled",
    narrowed: { fulfillment_status: ["shipped"] },
  },
]

describe.each(cases)(
  "$name tab search and filters",
  ({ Table, prefix, baseParams, narrowUrl, narrowed }) => {
    const renderAt = (url = "/") =>
      render(
        <MemoryRouter initialEntries={[url]}>
          <TooltipProvider>
            <Table />
            <LocationProbe />
          </TooltipProvider>
        </MemoryRouter>
      )
    const lastParams = () => mockUseOrders.mock.calls.at(-1)![0]
    const lastOptions = () => mockUseOrders.mock.calls.at(-1)![1]

    it("typing in the search box requests orders with id $in and without q", async () => {
      setOrders([])
      mockUseOrderSearch.mockImplementation((p: { q?: string }) => {
        return p.q
          ? { ...inactive, orderIds: ["order_1", "order_2"] }
          : inactive
      })
      const user = userEvent.setup()
      renderAt()

      await user.type(
        screen.getByPlaceholderText("orders.list.searchPlaceholder"),
        "smith"
      )

      await waitFor(() =>
        expect(lastParams().id).toEqual({ $in: ["order_1", "order_2"] })
      )
      expect(lastParams()).not.toHaveProperty("q")
    })

    it("a filter chip narrows the tab query and does not widen it", () => {
      mockUseOrderSearch.mockReturnValue(inactive)
      setOrders([])
      renderAt(`/?${narrowUrl}`)

      expect(lastParams()).toMatchObject(narrowed)
      // Everything the tab fixes is still there.
      for (const [key, value] of Object.entries(baseParams)) {
        if (key in narrowed) {
          continue
        }
        expect(lastParams()[key]).toEqual(value)
      }
    })

    it("no user criteria leaves the request identical to before", () => {
      mockUseOrderSearch.mockReturnValue(inactive)
      setOrders([])
      renderAt()

      const params = lastParams()
      expect(params).toEqual({
        fields: expect.any(String),
        ...baseParams,
        limit: 20,
        offset: 0,
        order: "-created_at",
      })
      expect(params).not.toHaveProperty("q")
      expect(lastOptions().enabled).toBe(true)
    })

    it("offset resets when criteria change", async () => {
      mockUseOrderSearch.mockReturnValue(inactive)
      setOrders([], 100)
      const user = userEvent.setup()
      renderAt(`/?${prefix}_offset=20`)
      expect(lastParams().offset).toBe(20)

      await user.type(
        screen.getByPlaceholderText("orders.list.searchPlaceholder"),
        "ab"
      )

      await waitFor(() => expect(lastParams().offset).toBe(0))
      await waitFor(() =>
        expect(screen.getByTestId("search").textContent).not.toContain(
          `${prefix}_offset`
        )
      )
    })

    it("no rows requested while the search is loading", () => {
      setOrders([order])
      mockUseOrderSearch.mockReturnValue({ ...inactive, isLoading: true })
      renderAt(`/?${prefix}_q=smith`)

      expect(lastOptions().enabled).toBe(false)
      expect(screen.queryByText("#4242")).toBeNull()
    })

    it("search error shows the inline error with Retry", async () => {
      const refetch = vi.fn()
      setOrders([order])
      mockUseOrderSearch.mockReturnValue({
        ...inactive,
        isError: true,
        refetch,
      })
      const user = userEvent.setup()
      renderAt(`/?${prefix}_q=smith`)

      expect(screen.getByText("orders.list.searchError")).toBeTruthy()
      expect(lastOptions().enabled).toBe(false)
      expect(screen.queryByText("#4242")).toBeNull()
      await user.click(
        screen.getByRole("button", { name: "orders.list.searchRetry" })
      )
      expect(refetch).toHaveBeenCalledTimes(1)
    })

    it("lists the rows once the search has resolved", () => {
      setOrders([order])
      mockUseOrderSearch.mockReturnValue({
        ...inactive,
        orderIds: ["order_1"],
      })
      renderAt(`/?${prefix}_q=smith`)

      expect(lastParams().id).toEqual({ $in: ["order_1"] })
      expect(screen.getByText("#4242")).toBeTruthy()
    })
  }
)

describe("tag filter in the toolbar", () => {
  const openFilterMenu = async (ui: ReactElement) => {
    mockUseOrderSearch.mockReturnValue(inactive)
    setOrders([])
    render(<MemoryRouter>{ui}</MemoryRouter>)
    await userEvent.setup().click(screen.getByText("filters.addFilter"))
  }

  it("tag_id filter is excluded from the toolbar on the On Hold tab", async () => {
    await openFilterMenu(<OnHoldTable />)
    expect(await screen.findByText("fields.salesChannel")).toBeTruthy()
    expect(screen.queryByText("fields.tags")).toBeNull()
  })

  it("other tabs still offer the tag filter", async () => {
    await openFilterMenu(<CancelledTable />)
    expect(await screen.findByText("fields.tags")).toBeTruthy()
  })
})
