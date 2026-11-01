// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Identity passthrough, matching the convention already used by
// `package-popover.spec.tsx`: every translated piece of UI text is asserted
// on by its raw i18n key rather than a human-readable string, since this
// package has no real i18n instance wired up for tests.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

const { mockUseStockLocations } = vi.hoisted(() => ({
  mockUseStockLocations: vi.fn(),
}))

// `ship-from-select.tsx` imports `useStockLocations`, which pulls in
// `lib/client` - that module reads build-time defines (`__AUTH_TYPE__` etc.)
// injected by the Vite config and isn't available under a plain component
// test. Mocked out purely to keep module evaluation side-effect free.
vi.mock("../../../../../../hooks/api/stock-locations", () => ({
  useStockLocations: (...args: any[]) => mockUseStockLocations(...args),
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

import { ShipFromSelect } from "./ship-from-select"

beforeEach(() => {
  mockUseStockLocations.mockReturnValue({
    stock_locations: [
      { id: "sloc_default", name: "Warehouse A" },
      { id: "sloc_b", name: "Warehouse B" },
    ],
    count: 2,
    isLoading: false,
    isError: false,
    error: undefined,
  })
})

afterEach(() => {
  cleanup()
  mockUseStockLocations.mockReset()
})

describe("ShipFromSelect", () => {
  it("defaults to the store's configured default location", async () => {
    render(
      <ShipFromSelect
        orderId="order_1"
        defaultLocationId="sloc_default"
        onChange={vi.fn()}
      />
    )

    expect(await screen.findByText("Warehouse A")).toBeTruthy()
  })

  it("calls onChange immediately when a different location is picked", async () => {
    const onChange = vi.fn()
    render(
      <ShipFromSelect
        orderId="order_1"
        defaultLocationId="sloc_default"
        onChange={onChange}
      />
    )

    fireEvent.click(await screen.findByRole("combobox"))
    fireEvent.click(screen.getByText("Warehouse B"))

    expect(onChange).toHaveBeenCalledWith("sloc_b")
  })

  it("renders no selected text when there is no default and nothing has been picked yet", () => {
    mockUseStockLocations.mockReturnValue({
      stock_locations: [
        { id: "sloc_default", name: "Warehouse A" },
        { id: "sloc_b", name: "Warehouse B" },
      ],
      count: 2,
      isLoading: false,
      isError: false,
      error: undefined,
    })

    render(
      <ShipFromSelect
        orderId="order_1"
        defaultLocationId={null}
        onChange={vi.fn()}
      />
    )

    expect(screen.queryByText("Warehouse A")).toBeNull()
    expect(screen.queryByText("Warehouse B")).toBeNull()
  })
})
