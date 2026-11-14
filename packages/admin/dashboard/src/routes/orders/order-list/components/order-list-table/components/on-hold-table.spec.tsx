// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { TooltipProvider } from "@medusajs/ui"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}))

const { mockUseOrders, mockUseHoldTag } = vi.hoisted(() => ({
  mockUseOrders: vi.fn(),
  mockUseHoldTag: vi.fn(),
}))

vi.mock("../../../../../../hooks/api/orders", () => ({
  useOrders: (...args: any[]) => mockUseOrders(...args),
  useCancelOrder: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock("../../../../../../hooks/api/order-holds", () => ({
  useHoldTag: () => mockUseHoldTag(),
  useReleaseOrder: () => ({ mutateAsync: vi.fn() }),
  useHoldOrder: () => ({ mutateAsync: vi.fn() }),
}))

if (!Element.prototype.scroll) {
  Element.prototype.scroll = vi.fn()
}

import { getHoldReason } from "./hold-reason"
import { OnHoldTable } from "./on-hold-table"

const makeOrder = (id: string, metadata?: Record<string, unknown> | null) => ({
  id,
  display_id: Number(id.replace(/\D/g, "")) || 1,
  created_at: "2024-01-01T00:00:00.000Z",
  currency_code: "usd",
  total: 1000,
  payment_status: "captured",
  fulfillment_status: "not_fulfilled",
  customer: null,
  metadata,
})

afterEach(() => {
  cleanup()
  mockUseOrders.mockReset()
  mockUseHoldTag.mockReset()
})

const renderTable = () =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <OnHoldTable />
      </TooltipProvider>
    </MemoryRouter>
  )

describe("getHoldReason", () => {
  it("is safe when metadata or the hold entry is absent", () => {
    expect(getHoldReason(undefined)).toBeNull()
    expect(getHoldReason(null)).toBeNull()
    expect(getHoldReason({})).toBeNull()
    expect(getHoldReason({ hold: null })).toBeNull()
    expect(getHoldReason({ hold: { reason: 5 } })).toBeNull()
    expect(getHoldReason({ hold: { reason: "fraud check" } })).toBe(
      "fraud check"
    )
  })
})

describe("OnHoldTable", () => {
  it("On Hold tab lists only tagged orders and shows the reason", () => {
    mockUseHoldTag.mockReturnValue({
      tagId: "tag_hold",
      isLoading: false,
      isError: false,
    })
    mockUseOrders.mockReturnValue({
      orders: [
        makeOrder("order_1", { hold: { reason: "Suspected fraud" } }),
        makeOrder("order_2", null),
      ],
      count: 2,
      isLoading: false,
      isError: false,
      error: undefined,
    })

    renderTable()

    const [params, options] = mockUseOrders.mock.calls.at(-1)!
    expect(params).toMatchObject({
      tag_id: "tag_hold",
      status: { $nin: ["canceled"] },
      limit: 20,
    })
    expect(params.fields).toContain("metadata")
    expect(options.enabled).toBe(true)
    expect(screen.getByText("orders.holdTable.reason")).toBeTruthy()
    expect(screen.getByText("Suspected fraud")).toBeTruthy()
    // one row-actions menu trigger per row, and the fulfillments are requested
    expect(params.fields).toContain("+fulfillments.id")
    expect(
      screen
        .getAllByRole("button")
        .filter((b) => b.getAttribute("aria-haspopup") === "menu")
    ).toHaveLength(2)
  })

  it("does not fetch while the tag is loading", () => {
    mockUseHoldTag.mockReturnValue({
      tagId: null,
      isLoading: true,
      isError: false,
    })
    mockUseOrders.mockReturnValue({
      orders: [],
      count: 0,
      isLoading: false,
      isError: false,
    })

    renderTable()

    expect(mockUseOrders.mock.calls.at(-1)![1].enabled).toBe(false)
  })

  it("throws to the error boundary when the tag lookup failed", () => {
    mockUseHoldTag.mockReturnValue({
      tagId: null,
      isLoading: false,
      isError: true,
    })
    mockUseOrders.mockReturnValue({
      orders: [],
      count: 0,
      isLoading: false,
      isError: false,
    })
    renderTable()

    expect(screen.getByText("orders.list.holdLookupError")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "orders.list.holdLookupRetry" })
    ).toBeTruthy()
    expect(mockUseOrders.mock.calls.at(-1)![1].enabled).toBe(false)
  })
})
