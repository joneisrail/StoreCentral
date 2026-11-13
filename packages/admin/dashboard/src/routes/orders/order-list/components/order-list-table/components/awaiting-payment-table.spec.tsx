// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}))

const { mockUseOrders, mockUseHoldTag, mockUseHeldOrderIds } = vi.hoisted(
  () => ({
    mockUseOrders: vi.fn(),
    mockUseHoldTag: vi.fn(),
    mockUseHeldOrderIds: vi.fn(),
  })
)

vi.mock("../../../../../../hooks/api/orders", () => ({
  useOrders: (...args: any[]) => mockUseOrders(...args),
}))
vi.mock("../../../../../../hooks/api/order-holds", () => ({
  useHoldTag: () => mockUseHoldTag(),
  useHeldOrderIds: () => mockUseHeldOrderIds(),
}))

if (!Element.prototype.scroll) {
  Element.prototype.scroll = vi.fn()
}

import { AwaitingPaymentTable } from "./awaiting-payment-table"

const emptyOrders = {
  orders: [],
  count: 0,
  isLoading: false,
  isError: false,
  error: undefined,
}

const setLookups = (
  tag: Record<string, unknown> = {},
  held: Record<string, unknown> = {}
) => {
  mockUseHoldTag.mockReturnValue({
    tagId: "tag_hold",
    isLoading: false,
    isError: false,
    ...tag,
  })
  mockUseHeldOrderIds.mockReturnValue({
    ids: ["order_held"],
    isLoading: false,
    isError: false,
    ...held,
  })
}

afterEach(() => {
  cleanup()
  mockUseOrders.mockReset()
  mockUseHoldTag.mockReset()
  mockUseHeldOrderIds.mockReset()
})

const renderTable = () =>
  render(
    <MemoryRouter>
      <AwaitingPaymentTable />
    </MemoryRouter>
  )

describe("AwaitingPaymentTable", () => {
  it("Awaiting Payment excludes canceled and held orders", () => {
    setLookups()
    mockUseOrders.mockReturnValue(emptyOrders)

    renderTable()

    const [params, options] = mockUseOrders.mock.calls.at(-1)!
    expect(params).toMatchObject({
      payment_status: ["not_paid", "awaiting"],
      status: { $nin: ["canceled"] },
      id: { $nin: ["order_held"] },
      limit: 20,
    })
    expect(options.enabled).toBe(true)
    expect(
      screen.getByText("orders.awaitingPayment.noRecordsMessage")
    ).toBeTruthy()
  })

  it("does not fetch while the held ids are loading", () => {
    setLookups({}, { isLoading: true })
    mockUseOrders.mockReturnValue(emptyOrders)

    renderTable()

    expect(mockUseOrders.mock.calls.at(-1)![1].enabled).toBe(false)
  })

  it("throws when the held ids lookup failed or was truncated", () => {
    setLookups({}, { isError: true })
    mockUseOrders.mockReturnValue(emptyOrders)
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})

    expect(() => renderTable()).toThrow()

    spy.mockRestore()
  })

  it("throws when the hold tag lookup failed", () => {
    setLookups({ isError: true })
    mockUseOrders.mockReturnValue(emptyOrders)
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})

    expect(() => renderTable()).toThrow()

    spy.mockRestore()
  })
})
