// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// `shipped-table.tsx` imports `useOrders`, which pulls in `lib/client` -
// that module reads build-time defines (`__AUTH_TYPE__` etc.) injected by
// the Vite config and isn't available under a plain component test. These
// cell components don't exercise data fetching, so the hook is mocked out
// purely to keep module evaluation side-effect free.
// Row actions read the shipping hooks, which pull in `lib/client` build defines.
vi.mock("../../../../../../hooks/api/order-holds", () => ({
  useReleaseOrder: () => ({ mutateAsync: vi.fn() }),
  useHoldOrder: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock("../../../../../../hooks/api/order-shipping", () => ({
  useVoidOrderLabel: () => ({ mutateAsync: vi.fn() }),
  useMarkOrderShipped: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock("../../../../../../hooks/use-date", () => ({
  useDate: () => ({ getFullDate: () => "date", getRelativeDate: () => "date" }),
}))

const { mockUseOrders } = vi.hoisted(() => ({ mockUseOrders: vi.fn() }))
vi.mock("../../../../../../hooks/api/orders", () => ({
  useCancelOrder: () => ({ mutateAsync: vi.fn() }),
  useOrders: (...args: unknown[]) => mockUseOrders(...args),
}))

if (!Element.prototype.scroll) {
  Element.prototype.scroll = vi.fn()
}

import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@medusajs/ui"
import { SHIPPED_QUERY } from "../../../order-views"
import {
  CarrierCell,
  getMostRecentShippedFulfillment,
  ShippedTable,
} from "./shipped-table"

const emptyResult = {
  orders: [],
  count: 0,
  isLoading: false,
  isError: false,
  error: undefined,
}

beforeEach(() => {
  mockUseOrders.mockReturnValue(emptyResult)
})

afterEach(() => {
  cleanup()
  mockUseOrders.mockReset()
})

describe("getMostRecentShippedFulfillment", () => {
  it("returns null when there are no fulfillments", () => {
    expect(getMostRecentShippedFulfillment(undefined)).toBeNull()
    expect(getMostRecentShippedFulfillment(null)).toBeNull()
    expect(getMostRecentShippedFulfillment([])).toBeNull()
  })

  it("excludes canceled fulfillments and fulfillments that haven't shipped yet", () => {
    const result = getMostRecentShippedFulfillment([
      {
        id: "ful_canceled",
        provider_id: "fp_canceled-carrier_v1",
        shipped_at: "2024-01-01T00:00:00.000Z",
        canceled_at: "2024-01-02T00:00:00.000Z",
      } as any,
      {
        id: "ful_unshipped",
        provider_id: "fp_unshipped-carrier_v1",
        shipped_at: null,
        canceled_at: null,
      } as any,
    ])

    expect(result).toBeNull()
  })

  it("picks the most recently shipped fulfillment among several", () => {
    const older = {
      id: "ful_older",
      provider_id: "fp_old-carrier_v1",
      shipped_at: "2024-01-01T00:00:00.000Z",
      canceled_at: null,
    } as any
    const newer = {
      id: "ful_newer",
      provider_id: "fp_new-carrier_v1",
      shipped_at: "2024-02-01T00:00:00.000Z",
      canceled_at: null,
    } as any

    expect(getMostRecentShippedFulfillment([older, newer])).toBe(newer)
    expect(getMostRecentShippedFulfillment([newer, older])).toBe(newer)
  })
})

describe("CarrierCell", () => {
  it("renders the formatted provider name for a shipped fulfillment", () => {
    render(
      <CarrierCell
        fulfillment={
          {
            id: "ful_1",
            provider_id: "fp_easypost",
            shipped_at: "2024-01-01T00:00:00.000Z",
            canceled_at: null,
          } as any
        }
      />
    )

    expect(screen.getByText("Easypost")).toBeTruthy()
  })

  it("renders a placeholder when there is no shipped fulfillment", () => {
    const { container } = render(<CarrierCell fulfillment={null} />)

    expect(container.textContent).not.toBe("")
    expect(screen.queryByText("Easypost")).toBeNull()
  })
})

describe("ShippedTable", () => {
  const renderTable = () =>
    render(
      <MemoryRouter>
        <TooltipProvider>
          <ShippedTable />
        </TooltipProvider>
      </MemoryRouter>
    )

  it("queries the shared SHIPPED_QUERY, which includes fulfilled", () => {
    renderTable()
    const [params] = mockUseOrders.mock.calls[0]
    expect(params).toMatchObject(SHIPPED_QUERY)
    expect(params.fulfillment_status).toContain("fulfilled")
  })

  it("renders a bought-but-unshipped order without shipped_at, with Void label", async () => {
    mockUseOrders.mockReturnValue({
      ...emptyResult,
      count: 1,
      orders: [
        {
          id: "order_1",
          display_id: 9,
          fulfillment_status: "fulfilled",
          currency_code: "usd",
          total: 100,
          customer: null,
          fulfillments: [
            {
              id: "ful_1",
              provider_id: "fp_easypost",
              data: { easypost_shipment_id: "shp_1" },
              shipped_at: null,
              canceled_at: null,
            },
          ],
        },
      ],
    })
    renderTable()
    expect(screen.getByText("#9")).toBeTruthy()
    const row = screen.getByText("#9").closest("tr") as HTMLElement
    await userEvent.click(within(row).getByRole("button"))
    expect(await screen.findByText("orders.shipping.voidLabel")).toBeTruthy()
  })
})
