// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

// Identity passthrough, matching the convention already used by
// `ship-from-select.spec.tsx`/`package-popover.spec.tsx`: every translated
// piece of UI text is asserted on by its raw i18n key rather than a
// human-readable string, since this package has no real i18n instance
// wired up for tests.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

const { mockUseOrderCarrierRates } = vi.hoisted(() => ({
  mockUseOrderCarrierRates: vi.fn(),
}))

// `shipping-rate-select.tsx` imports `useOrderCarrierRates`, which pulls in
// `lib/client` - that module reads build-time defines (`__AUTH_TYPE__` etc.)
// injected by the Vite config and isn't available under a plain component
// test. Mocked out purely to keep module evaluation side-effect free, same
// reasoning as `ship-from-select.spec.tsx`'s `useStockLocations` mock.
vi.mock("../../../../../../hooks/api/orders", () => ({
  useOrderCarrierRates: (...args: any[]) => mockUseOrderCarrierRates(...args),
}))

// jsdom doesn't implement these - Radix `Select`'s pointer-based open/select
// handling calls them unconditionally, which would otherwise throw as soon
// as the trigger or an item is clicked.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = vi.fn()
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn()
}

import { ShippingRateSelect } from "./shipping-rate-select"

const parcel = { weight: 16 }

const TWO_RATES = {
  shipment_id: "shp_1",
  rates: [
    {
      carrier: "FedEx",
      service: "Ground",
      name: "FedEx Ground",
      rate_id: "rate_fedex",
      amount: "7.50",
      currency: "USD",
    },
    {
      carrier: "USPS",
      service: "Priority",
      name: "USPS Priority",
      rate_id: "rate_usps",
      amount: "9.00",
      currency: "USD",
    },
  ],
}

afterEach(() => {
  cleanup()
  mockUseOrderCarrierRates.mockReset()
})

describe("ShippingRateSelect", () => {
  it("auto-selects the cheapest rate once quoted", async () => {
    const onChange = vi.fn()
    mockUseOrderCarrierRates.mockReturnValue({
      data: TWO_RATES,
      isError: false,
      refetch: vi.fn(),
    })

    render(
      <ShippingRateSelect
        orderId="order_1"
        locationId="sloc_1"
        parcel={parcel}
        onChange={onChange}
      />
    )

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        shipmentId: "shp_1",
        rateId: "rate_fedex",
      })
    )
    expect(await screen.findByText(/FedEx Ground/)).toBeTruthy()
  })

  it("lets the admin pick a different quoted rate from the dropdown", async () => {
    const onChange = vi.fn()
    mockUseOrderCarrierRates.mockReturnValue({
      data: TWO_RATES,
      isError: false,
      refetch: vi.fn(),
    })

    render(
      <ShippingRateSelect
        orderId="order_1"
        locationId="sloc_1"
        parcel={parcel}
        onChange={onChange}
      />
    )

    await screen.findByText(/FedEx Ground/)
    fireEvent.click(screen.getByRole("combobox"))
    fireEvent.click(screen.getByText(/USPS Priority/))

    expect(onChange).toHaveBeenLastCalledWith({
      shipmentId: "shp_1",
      rateId: "rate_usps",
    })
  })

  it("does not re-fire the auto-select (clobbering a manual pick) when the component re-renders with the exact same cached query data", async () => {
    const onChange = vi.fn()
    mockUseOrderCarrierRates.mockReturnValue({
      data: TWO_RATES,
      isError: false,
      refetch: vi.fn(),
    })

    const { rerender } = render(
      <ShippingRateSelect
        orderId="order_1"
        locationId="sloc_1"
        parcel={parcel}
        onChange={onChange}
      />
    )

    await screen.findByText(/FedEx Ground/)
    fireEvent.click(screen.getByRole("combobox"))
    fireEvent.click(screen.getByText(/USPS Priority/))
    expect(onChange).toHaveBeenLastCalledWith({
      shipmentId: "shp_1",
      rateId: "rate_usps",
    })
    onChange.mockClear()

    // An unrelated re-render (e.g. a parent re-render that doesn't change
    // this row's query key at all) - `data` is still the exact same cached
    // object `mockUseOrderCarrierRates` keeps returning. The ref guard must
    // treat this as "already auto-selected for this data" and not fire
    // `onChange` again, which would otherwise clobber the manual pick above
    // back to the cheapest rate.
    rerender(
      <ShippingRateSelect
        orderId="order_1"
        locationId="sloc_1"
        parcel={parcel}
        onChange={onChange}
      />
    )

    expect(onChange).not.toHaveBeenCalled()
  })

  it("auto-selects again once a new quote (different cached data) arrives for the same row", async () => {
    const onChange = vi.fn()
    mockUseOrderCarrierRates.mockReturnValue({
      data: TWO_RATES,
      isError: false,
      refetch: vi.fn(),
    })

    const { rerender } = render(
      <ShippingRateSelect
        orderId="order_1"
        locationId="sloc_1"
        parcel={parcel}
        onChange={onChange}
      />
    )

    await screen.findByText(/FedEx Ground/)
    onChange.mockClear()

    const NEW_QUOTE = {
      shipment_id: "shp_2",
      rates: [
        {
          carrier: "UPS",
          service: "Ground",
          name: "UPS Ground",
          rate_id: "rate_ups",
          amount: "6.00",
          currency: "USD",
        },
      ],
    }
    mockUseOrderCarrierRates.mockReturnValue({
      data: NEW_QUOTE,
      isError: false,
      refetch: vi.fn(),
    })

    // A different `locationId`/`parcel` is what actually changes the query
    // key in the real hook - re-rendered here with new props to mirror that.
    rerender(
      <ShippingRateSelect
        orderId="order_1"
        locationId="sloc_2"
        parcel={parcel}
        onChange={onChange}
      />
    )

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        shipmentId: "shp_2",
        rateId: "rate_ups",
      })
    )
    expect(await screen.findByText(/UPS Ground/)).toBeTruthy()
  })

  it("shows an inline error with retry when quoting fails", async () => {
    const mockRefetch = vi.fn()
    mockUseOrderCarrierRates.mockReturnValue({
      data: undefined,
      isError: true,
      refetch: mockRefetch,
    })

    render(
      <ShippingRateSelect
        orderId="order_1"
        locationId="sloc_1"
        parcel={parcel}
        onChange={vi.fn()}
      />
    )

    const retryButton = await screen.findByRole("button", { name: /retry/i })
    expect(retryButton).toBeTruthy()

    fireEvent.click(retryButton)
    expect(mockRefetch).toHaveBeenCalledTimes(1)
  })
})
