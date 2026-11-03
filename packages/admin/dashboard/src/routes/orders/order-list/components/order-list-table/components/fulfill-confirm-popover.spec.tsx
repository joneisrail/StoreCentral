// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@medusajs/ui"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

const { mutateAsync, mockUseStockLocations } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  mockUseStockLocations: vi.fn(),
}))

// `fulfill-confirm-popover.tsx` consumes the real `useBulkFulfillOrders`
// mutation hook (a one-item `fulfillments` array, same as the Ready to
// Ship table's own bulk "Fulfill selected" command). It's mocked here the
// same way `useOrders` is mocked in `ready-to-ship-table.spec.tsx`: to
// control success/failure deterministically and to keep module evaluation
// free of `lib/client`'s build-time defines.
vi.mock("../../../../../../hooks/api/orders", () => ({
  useBulkFulfillOrders: () => ({
    mutateAsync,
    isPending: false,
  }),
}))

// `fulfill-confirm-popover.tsx` imports `ReadyToShipOrder`/`DisabledFulfillCell`
// from `./ready-to-ship-table`, which - as a whole module - also imports
// `useStore` (for the Ship From column's store-wide default). That pulls in
// `lib/client`'s build-time defines at module-evaluation time, regardless of
// whether `ReadyToShipTable` itself is ever rendered here, so it needs
// mocking for the same reason `useOrders` above does.
vi.mock("../../../../../../hooks/api/store", () => ({
  useStore: () => ({ store: undefined }),
}))

// `fulfill-confirm-popover.tsx` itself now reads `useStockLocations`
// directly (to resolve the resolved `location_id`'s display name - the
// same lookup `ShipFromSelect` does), not just transitively via
// `ready-to-ship-table.tsx`. Configurable per test via `mockReturnValue`/
// `mockClear()`, same pattern as `ready-to-ship-table.spec.tsx`'s own
// `mockUseStockLocations`.
vi.mock("../../../../../../hooks/api/stock-locations", () => ({
  useStockLocations: (...args: any[]) => mockUseStockLocations(...args),
}))

import { FulfillConfirmPopover } from "./fulfill-confirm-popover"

const baseOrder = {
  id: "order_1",
  shipping_methods: [
    {
      id: "sm_1",
      shipping_option_id: "so_1",
      shipping_option: {
        service_zone: {
          fulfillment_set: {
            location: { id: "loc_1", name: "Warehouse A" },
          },
        },
      },
    },
  ],
  items: [
    {
      id: "item_1",
      title: "T-Shirt",
      quantity: 2,
      detail: { fulfilled_quantity: 0 },
    },
    {
      id: "item_2",
      title: "Already fulfilled item",
      quantity: 1,
      detail: { fulfilled_quantity: 1 },
    },
  ],
} as any

// This order's quoted rate - present for every test below except the ones
// specifically covering the "no quote yet" gate, keyed the same way
// `ReadyToShipTable`'s own `rowRates` state is.
const quotedRate = { order_1: { shipmentId: "shp_1", rateId: "rate_1" } }

afterEach(() => {
  cleanup()
  mutateAsync.mockReset()
  mockUseStockLocations.mockClear()
})

// `loc_1` (the shipping method's own checkout-time location, named
// "Warehouse A") is deliberately *not* `defaultLocationId` in most tests
// below - distinguishing it from `loc_store_default`/`sloc_a` is what
// proves the component resolves/displays/sends the same location
// `buildBulkFulfillments` would (store default or override), not the
// shipping method's own location.
mockUseStockLocations.mockReturnValue({
  stock_locations: [
    { id: "loc_1", name: "Warehouse A" },
    { id: "loc_store_default", name: "Store Default Warehouse" },
    { id: "sloc_a", name: "Warehouse A2" },
  ],
})

describe("FulfillConfirmPopover", () => {
  it("renders the inert, disabled Fulfill button when the order has no shipping method - no popover is wired", () => {
    render(
      <TooltipProvider>
        <FulfillConfirmPopover
          order={{ ...baseOrder, shipping_methods: [] }}
          rowLocationOverride={{}}
          rowRates={quotedRate}
          defaultLocationId={null}
        />
      </TooltipProvider>
    )

    const button = screen.getByRole("button", {
      name: "orders.readyToShip.fulfill",
    }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it("renders the inert, disabled Fulfill button - with its own distinct 'rate not ready' tooltip, not 'no shipping method' - when the order has a shipping method but no quoted rate yet", async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <FulfillConfirmPopover
          order={baseOrder}
          rowLocationOverride={{}}
          rowRates={{}}
          defaultLocationId={null}
        />
      </TooltipProvider>
    )

    const button = screen.getByRole("button", {
      name: "orders.readyToShip.fulfill",
    }) as HTMLButtonElement
    expect(button.disabled).toBe(true)

    await user.hover(button)

    // Distinct from the no-shipping-method case's tooltip - this row does
    // have a shipping method, it's the quote that's missing.
    await waitFor(() => {
      expect(
        screen.getAllByText("orders.readyToShip.noRateYet").length
      ).toBeGreaterThan(0)
    })
    expect(screen.queryByText("orders.readyToShip.noShippingMethod")).toBeNull()
  })

  it("opens a read-only confirmation showing the resolved location and only the remaining-quantity items", async () => {
    const user = userEvent.setup()
    render(
      <FulfillConfirmPopover
        order={baseOrder}
        rowLocationOverride={{}}
        rowRates={quotedRate}
        defaultLocationId="loc_1"
      />
    )

    await user.click(
      screen.getByRole("button", { name: "orders.readyToShip.fulfill" })
    )

    expect(await screen.findByText("Warehouse A")).toBeTruthy()
    expect(screen.getByText("2x T-Shirt")).toBeTruthy()
    expect(screen.queryByText(/Already fulfilled item/)).toBeNull()

    // read-only: no inputs to edit location or quantities, just Confirm/Cancel
    expect(screen.queryAllByRole("textbox").length).toBe(0)
    expect(screen.queryAllByRole("spinbutton").length).toBe(0)
  })

  it("displays, quotes against, and sends the store-wide default location - not the shipping method's own checkout-time location - when no Ship From override is set, and closes the popover on success", async () => {
    mutateAsync.mockResolvedValueOnce({ succeeded: ["order_1"], failed: [] })
    const user = userEvent.setup()
    render(
      <FulfillConfirmPopover
        order={baseOrder}
        rowLocationOverride={{}}
        rowRates={quotedRate}
        defaultLocationId="loc_store_default"
      />
    )

    await user.click(
      screen.getByRole("button", { name: "orders.readyToShip.fulfill" })
    )

    // Displays the store default's own name ("Store Default Warehouse"),
    // not the shipping method's "Warehouse A" - the same location
    // `ShippingRateSelect` already quoted this row against.
    expect(await screen.findByText("Store Default Warehouse")).toBeTruthy()
    expect(screen.queryByText("Warehouse A")).toBeNull()

    await user.click(screen.getByRole("button", { name: "actions.confirm" }))

    expect(mutateAsync).toHaveBeenCalledWith({
      fulfillments: [
        {
          order_id: "order_1",
          location_id: "loc_store_default",
          shipment_id: "shp_1",
          rate_id: "rate_1",
        },
      ],
    })

    await waitFor(() => {
      expect(screen.queryByText("orders.readyToShip.confirmHeading")).toBeNull()
    })
  })

  it("displays, quotes against, and sends the row's own Ship From override - overriding the store default - on Confirm", async () => {
    mutateAsync.mockResolvedValueOnce({ succeeded: ["order_1"], failed: [] })
    const user = userEvent.setup()
    render(
      <FulfillConfirmPopover
        order={baseOrder}
        rowLocationOverride={{ order_1: "sloc_a" }}
        rowRates={{ order_1: { shipmentId: "shp_a", rateId: "rate_a" } }}
        defaultLocationId="loc_store_default"
      />
    )

    await user.click(
      screen.getByRole("button", { name: "orders.readyToShip.fulfill" })
    )

    expect(await screen.findByText("Warehouse A2")).toBeTruthy()
    expect(screen.queryByText("Store Default Warehouse")).toBeNull()

    await user.click(screen.getByRole("button", { name: "actions.confirm" }))

    expect(mutateAsync).toHaveBeenCalledWith({
      fulfillments: [
        {
          order_id: "order_1",
          location_id: "sloc_a",
          shipment_id: "shp_a",
          rate_id: "rate_a",
        },
      ],
    })
  })

  it("keeps the popover open and surfaces the thrown workflow error inline, not as a toast, on a request-level failure (the mutation's promise rejecting)", async () => {
    mutateAsync.mockRejectedValueOnce(
      new Error("Unable to buy a shipping label: incomplete address")
    )
    const user = userEvent.setup()
    render(
      <FulfillConfirmPopover
        order={baseOrder}
        rowLocationOverride={{}}
        rowRates={quotedRate}
        defaultLocationId="loc_1"
      />
    )

    await user.click(
      screen.getByRole("button", { name: "orders.readyToShip.fulfill" })
    )
    await user.click(screen.getByRole("button", { name: "actions.confirm" }))

    expect(
      await screen.findByText(
        "Unable to buy a shipping label: incomplete address"
      )
    ).toBeTruthy()
    expect(screen.getByText("orders.readyToShip.confirmHeading")).toBeTruthy()
  })

  it("keeps the popover open and surfaces this order's own error inline when the batch response resolves (HTTP 200) with this order recorded in failed[], rather than treating the resolved promise as success", async () => {
    mutateAsync.mockResolvedValueOnce({
      succeeded: [],
      failed: [
        {
          order_id: "order_1",
          error: "Unable to buy a shipping label: incomplete address",
        },
      ],
    })
    const user = userEvent.setup()
    render(
      <FulfillConfirmPopover
        order={baseOrder}
        rowLocationOverride={{}}
        rowRates={quotedRate}
        defaultLocationId="loc_1"
      />
    )

    await user.click(
      screen.getByRole("button", { name: "orders.readyToShip.fulfill" })
    )
    await user.click(screen.getByRole("button", { name: "actions.confirm" }))

    expect(
      await screen.findByText(
        "Unable to buy a shipping label: incomplete address"
      )
    ).toBeTruthy()
    expect(screen.getByText("orders.readyToShip.confirmHeading")).toBeTruthy()
    // No label was bought for this failure - no orphaned-label notice.
    expect(screen.queryByText("orders.readyToShip.orphanedLabel")).toBeNull()
  })

  it("tells the admin a label was already bought, with its shipment id, when the fulfillment failed after the purchase", async () => {
    mutateAsync.mockResolvedValueOnce({
      succeeded: [],
      failed: [
        {
          order_id: "order_1",
          error: "Fulfillment could not be recorded",
          easypost_shipment_id: "shp_bought_1",
        },
      ],
    })
    const user = userEvent.setup()
    render(
      <FulfillConfirmPopover
        order={baseOrder}
        rowLocationOverride={{}}
        rowRates={quotedRate}
        defaultLocationId="loc_1"
      />
    )

    await user.click(
      screen.getByRole("button", { name: "orders.readyToShip.fulfill" })
    )
    await user.click(screen.getByRole("button", { name: "actions.confirm" }))

    expect(
      await screen.findByText("Fulfillment could not be recorded")
    ).toBeTruthy()
    expect(screen.getByText("orders.readyToShip.orphanedLabel")).toBeTruthy()
  })

  it("falls back to the checkout shipping option's own location - displayed and sent - only when no override and no store default exist", async () => {
    mutateAsync.mockResolvedValueOnce({ succeeded: ["order_1"], failed: [] })
    const user = userEvent.setup()
    render(
      <FulfillConfirmPopover
        order={baseOrder}
        rowLocationOverride={{}}
        rowRates={quotedRate}
        defaultLocationId={null}
      />
    )

    await user.click(
      screen.getByRole("button", { name: "orders.readyToShip.fulfill" })
    )
    expect(await screen.findByText("Warehouse A")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "actions.confirm" }))

    expect(mutateAsync).toHaveBeenCalledWith({
      fulfillments: [
        expect.objectContaining({ order_id: "order_1", location_id: "loc_1" }),
      ],
    })
  })
})
