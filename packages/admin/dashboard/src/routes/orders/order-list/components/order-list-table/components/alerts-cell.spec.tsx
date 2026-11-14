// @vitest-environment jsdom
import { TooltipProvider } from "@medusajs/ui"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      return options ? `${key}:${JSON.stringify(options)}` : key
    },
  }),
}))

const { mockUseOrderCarrierRates } = vi.hoisted(() => ({
  mockUseOrderCarrierRates: vi.fn(),
}))

vi.mock("../../../../../../hooks/api/orders", () => ({
  useOrderCarrierRates: (...args: unknown[]) =>
    mockUseOrderCarrierRates(...args),
}))

import { AlertsCell } from "./alerts-cell"

afterEach(() => {
  cleanup()
  mockUseOrderCarrierRates.mockReset()
})

const rates = {
  shipment_id: "shp_1",
  rates: [
    {
      rate_id: "r1",
      carrier: "UPS",
      name: "UPS Ground",
      amount: "5",
      currency: "usd",
    },
  ],
}

const order = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "order_1",
    total: 100,
    payment_status: "captured",
    items: [{ id: "i1", variant: { weight: 5 } }],
    shipping_address: { address_1: "PO Box 12" },
    ...overrides,
  }) as never

const renderCell = (o: never, extra: Record<string, unknown> = {}) =>
  render(
    <TooltipProvider>
      <AlertsCell
        order={o}
        locationId="loc_1"
        parcel={{ weight: 1 }}
        selectedRateId="r1"
        highValueThreshold={500}
        {...extra}
      />
    </TooltipProvider>
  )

describe("AlertsCell", () => {
  it("lists every reason on hover", async () => {
    mockUseOrderCarrierRates.mockReturnValue({ data: rates, isError: false })
    const user = userEvent.setup()

    renderCell(
      order({
        payment_status: "awaiting",
        total: 900,
        items: [{ id: "i1", variant: { weight: null } }],
      })
    )

    const trigger = screen.getByTestId("order-alerts")
    expect(trigger.getAttribute("data-row-alert")).not.toBeNull()
    await user.hover(trigger)

    for (const code of [
      "missing_weight",
      "payment_pending",
      "po_box_non_usps",
      "high_value",
    ]) {
      expect(
        (await screen.findAllByText(new RegExp(`alerts\\.${code}`))).length
      ).toBeGreaterThan(0)
    }
    expect(
      (await screen.findAllByText(/alerts\.po_box_non_usps:.*UPS/)).length
    ).toBeGreaterThan(0)
  })

  it("flags no_rates when the quote failed", async () => {
    mockUseOrderCarrierRates.mockReturnValue({ data: undefined, isError: true })
    const user = userEvent.setup()

    renderCell(order({ shipping_address: { address_1: "1 Main" } }), {
      selectedRateId: undefined,
    })
    await user.hover(screen.getByTestId("order-alerts"))

    expect(
      (await screen.findAllByText(/alerts\.no_rates/)).length
    ).toBeGreaterThan(0)
  })

  it("renders nothing when there are no alerts", () => {
    mockUseOrderCarrierRates.mockReturnValue({ data: rates, isError: false })

    const { container } = renderCell(
      order({ shipping_address: { address_1: "1 Main" } })
    )

    expect(container.textContent).toBe("")
    expect(screen.queryByTestId("order-alerts")).toBeNull()
  })

  it("does not alert while the quote is still loading", () => {
    mockUseOrderCarrierRates.mockReturnValue({
      data: undefined,
      isError: false,
    })

    renderCell(order({ shipping_address: { address_1: "1 Main" } }), {
      selectedRateId: undefined,
    })

    expect(screen.queryByTestId("order-alerts")).toBeNull()
  })
})
