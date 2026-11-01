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

const mutateAsync = vi.fn()

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

// `fulfill-confirm-popover.tsx` imports `getShipFromLocationId`/
// `getShipFromLocationName` from `./ready-to-ship-table`, which - as a
// whole module - also imports `useStore` (for the Ship From column's
// store-wide default). That pulls in `lib/client`'s build-time defines at
// module-evaluation time, regardless of whether `ReadyToShipTable` itself
// is ever rendered here, so it needs mocking for the same reason
// `useOrders` above does.
vi.mock("../../../../../../hooks/api/store", () => ({
  useStore: () => ({ store: undefined }),
}))

// Same reasoning as the `useStore` mock above: `ready-to-ship-table.tsx`
// also imports `ShipFromSelect`, which imports `useStockLocations`.
vi.mock("../../../../../../hooks/api/stock-locations", () => ({
  useStockLocations: () => ({ stock_locations: [] }),
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
})

describe("FulfillConfirmPopover", () => {
  it("renders the inert, disabled Fulfill button when the order has no shipping method - no popover is wired", () => {
    render(
      <TooltipProvider>
        <FulfillConfirmPopover
          order={{ ...baseOrder, shipping_methods: [] }}
          rowLocationOverride={{}}
          rowRates={quotedRate}
        />
      </TooltipProvider>
    )

    const button = screen.getByRole("button", {
      name: "orders.readyToShip.fulfill",
    }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it("renders the inert, disabled Fulfill button when the order has a shipping method but no quoted rate yet - buying a label needs the shipment_id/rate_id a quote provides", () => {
    render(
      <TooltipProvider>
        <FulfillConfirmPopover
          order={baseOrder}
          rowLocationOverride={{}}
          rowRates={{}}
        />
      </TooltipProvider>
    )

    const button = screen.getByRole("button", {
      name: "orders.readyToShip.fulfill",
    }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it("opens a read-only confirmation showing the default location and only the remaining-quantity items", async () => {
    const user = userEvent.setup()
    render(
      <FulfillConfirmPopover
        order={baseOrder}
        rowLocationOverride={{}}
        rowRates={quotedRate}
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

  it("confirms with the unmodified defaults and closes the popover on success", async () => {
    mutateAsync.mockResolvedValueOnce({})
    const user = userEvent.setup()
    render(
      <FulfillConfirmPopover
        order={baseOrder}
        rowLocationOverride={{}}
        rowRates={quotedRate}
      />
    )

    await user.click(
      screen.getByRole("button", { name: "orders.readyToShip.fulfill" })
    )
    expect(await screen.findByText("Warehouse A")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "actions.confirm" }))

    expect(mutateAsync).toHaveBeenCalledWith({
      fulfillments: [
        {
          order_id: "order_1",
          location_id: "loc_1",
          shipment_id: "shp_1",
          rate_id: "rate_1",
        },
      ],
    })

    await waitFor(() => {
      expect(screen.queryByText("orders.readyToShip.confirmHeading")).toBeNull()
    })
  })

  it("calls useBulkFulfillOrders with a one-item fulfillments array using the row's Ship From override on Confirm", async () => {
    mutateAsync.mockResolvedValueOnce({})
    const user = userEvent.setup()
    render(
      <FulfillConfirmPopover
        order={baseOrder}
        rowLocationOverride={{ order_1: "sloc_a" }}
        rowRates={{ order_1: { shipmentId: "shp_a", rateId: "rate_a" } }}
      />
    )

    await user.click(
      screen.getByRole("button", { name: "orders.readyToShip.fulfill" })
    )
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

  it("keeps the popover open and surfaces the thrown workflow error inline, not as a toast, on failure", async () => {
    mutateAsync.mockRejectedValueOnce(
      new Error("Unable to buy a shipping label: incomplete address")
    )
    const user = userEvent.setup()
    render(
      <FulfillConfirmPopover
        order={baseOrder}
        rowLocationOverride={{}}
        rowRates={quotedRate}
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
})
