// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@medusajs/ui"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { OrderCarrierRatesResponse } from "../../../../../../hooks/api/orders"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      return options ? `${key}:${JSON.stringify(options)}` : key
    },
    // `use-date.tsx` (behind `DateCell`, rendered by the bulk-command
    // tests' full `ReadyToShipTable` render below) reads `i18n.language`
    // directly, not just `t`.
    i18n: { language: "en" },
  }),
}))

const {
  mockUseOrders,
  mockBulkFulfillOrders,
  mockBulkFulfillResultSummary,
  mockToastError,
  mockPrompt,
  mockUseStore,
  mockUseStockLocations,
  mockUseOrderCarrierRates,
  mockUseHoldTag,
  mockUseHeldOrderIds,
} = vi.hoisted(() => ({
  mockUseOrders: vi.fn(),
  mockBulkFulfillOrders: vi.fn(),
  mockBulkFulfillResultSummary: vi.fn(),
  mockToastError: vi.fn(),
  mockPrompt: vi.fn(),
  mockUseStore: vi.fn(),
  mockUseStockLocations: vi.fn(),
  mockUseOrderCarrierRates: vi.fn(),
  mockUseHoldTag: vi.fn(),
  mockUseHeldOrderIds: vi.fn(),
}))

// `ReadyToShipTable` takes its query from `getViewQuery`, which needs the
// hold tag and held order ids; both hooks reach `lib/client`, so they are
// mocked with per-test-overridable defaults (set below, reset in afterEach).
vi.mock("../../../../../../hooks/api/order-holds", () => ({
  useHoldTag: () => mockUseHoldTag(),
  useHeldOrderIds: () => mockUseHeldOrderIds(),
}))

// Only `toast.error`/`usePrompt` are swapped out for spies - everything
// else (`Button`, `Checkbox`, `CommandBar`, `Alert`, ...) stays the real
// `@medusajs/ui` implementation, since the bulk-command tests below render
// the real `_DataTable`/`CommandBar` to exercise row selection and the
// command bar, not a stub of them. `usePrompt` is mocked rather than
// rendered for real because the real implementation needs a
// `PromptProvider` higher in the tree, which these tests don't set up -
// defaulting it to resolve `true` keeps every pre-existing bulk-command
// test below (written before the confirm step existed) passing unchanged.
vi.mock("@medusajs/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@medusajs/ui")>()
  return {
    ...actual,
    toast: {
      ...actual.toast,
      error: mockToastError,
    },
    usePrompt: () => mockPrompt,
  }
})

// `ready-to-ship-table.tsx` imports `useOrders`/`useBulkFulfillOrders`
// (and, transitively via `FulfillConfirmPopover`, the same
// `useBulkFulfillOrders` - Task 13 moved the single-row Fulfill action onto
// it too, away from `useCreateOrderFulfillment`), which pull in
// `lib/client` - that module reads build-time defines (`__AUTH_TYPE__`
// etc.) injected by the Vite config and isn't available under a plain
// component test. Mocked out purely to keep module evaluation side-effect
// free; `mockUseOrders`'s return value is configured per test via
// `mockReturnValue` so the plain-cell tests below (which never render
// `ReadyToShipTable` itself) and the bulk-command tests (which do) can use
// different fixtures in the same file.
//
// `useOrderCarrierRates` (Task 11) is mocked for the same reason - the
// `shipping_rate` column's cell now renders `ShippingRateSelect`, which
// reads it directly, in every test below that renders the full
// `ReadyToShipTable`. Its default (set once below, same `mockClear()`
// reasoning as `mockUseStore`/`mockUseStockLocations`) resolves no rates
// for an order no test has opted into one for via `setOrderRate` - so this
// task's own auto-select/manual-pick behavior - already covered in
// isolation by `shipping-rate-select.spec.tsx` - doesn't fire unexpectedly
// in these bulk-command/Ship-From-focused tests. Task 13's own `rowRates`
// gate (both the bulk checkbox and `FulfillConfirmPopover` now additionally
// require a quoted rate to be selectable/fulfillable) means most of this
// file's bulk-command/Fulfill tests now call `setOrderRate` deliberately,
// to exercise the row(s) they need selectable.
vi.mock("../../../../../../hooks/api/orders", () => ({
  useOrders: (...args: any[]) => mockUseOrders(...args),
  useBulkFulfillOrders: () => ({
    mutateAsync: mockBulkFulfillOrders,
    isPending: false,
  }),
  useOrderCarrierRates: (...args: any[]) => mockUseOrderCarrierRates(...args),
}))

// `ready-to-ship-table.tsx` now also reads `useStore` directly (for the
// store-wide default ship-from location), and the `ship_from` column's
// cell renders `ShipFromSelect`, which reads `useStockLocations` - both
// pull in the same build-time-define-dependent `lib/client` as `orders`
// above, so both are mocked out for the same reason.
// The Tags cell renders `BulkTagOrdersModal` (via `row-tags-cell.tsx`), which
// pulls in `lib/client` build-time defines through `hooks/api/order-tags`.
vi.mock("./bulk-tag-orders-modal", () => ({
  BulkTagOrdersModal: () => null,
}))

vi.mock("../../../../../../hooks/api/store", () => ({
  useStore: (...args: any[]) => mockUseStore(...args),
}))

vi.mock("../../../../../../hooks/api/stock-locations", () => ({
  useStockLocations: (...args: any[]) => mockUseStockLocations(...args),
}))

// Stubbed so the bulk-command tests below can assert exactly what props
// `ReadyToShipTable` passes it, without depending on its own i18n
// interpolation - that's covered directly in
// `bulk-fulfill-result-summary.spec.tsx`.
vi.mock("./bulk-fulfill-result-summary", () => ({
  BulkFulfillResultSummary: (props: any) => {
    mockBulkFulfillResultSummary(props)
    return (
      <div data-testid="bulk-fulfill-result-summary">
        succeeded:{props.result.succeeded.join(",")}|failed:
        {props.result.failed
          .map((f: any) => `${f.order_id}:${f.error}`)
          .join(",")}
        <button onClick={props.onDismiss}>dismiss</button>
      </div>
    )
  },
  OrphanedLabelNotice: ({ shipmentId }: { shipmentId: string }) => (
    <span>orphaned:{shipmentId}</span>
  ),
}))

import {
  buildBulkFulfillments,
  DisabledFulfillCell,
  isSamePackageSelection,
  PackageCell,
  ReadyToShipTable,
  ShipFromCell,
  ShippingRateCell,
} from "./ready-to-ship-table"

// Per-order quote fixtures for `mockUseOrderCarrierRates` below, keyed by
// order id - empty (no quote, still "loading") by default, which keeps
// `ShippingRateSelect`'s own auto-select effect from firing for a row whose
// test doesn't opt in. A test that needs a row to actually be
// selectable/fulfillable (Task 13's own `rowRates` gate) sets an entry here
// *before* rendering - `setOrderRate` stores the `data` object by
// reference, once, so repeated calls to `useOrderCarrierRates` for the same
// order id (e.g. on an unrelated re-render) return the exact same object -
// the reference equality `ShippingRateSelect`'s auto-select effect itself
// relies on to fire only once per genuinely new quote.
let ratesByOrder: Record<string, OrderCarrierRatesResponse> = {}

const setOrderRate = (
  orderId: string,
  shipmentId: string,
  rateId: string,
  amount = "5.00"
) => {
  ratesByOrder[orderId] = {
    shipment_id: shipmentId,
    rates: [
      {
        carrier: "USPS",
        service: "Priority",
        name: "USPS Priority",
        rate_id: rateId,
        amount,
        currency: "usd",
      },
    ],
  }
}

afterEach(() => {
  cleanup()
  mockUseOrders.mockReset()
  mockBulkFulfillOrders.mockReset()
  mockBulkFulfillResultSummary.mockReset()
  mockToastError.mockReset()
  // `mockClear()`, not `mockReset()`: clears call history between tests
  // but keeps the `mockResolvedValue(true)` default below, so every
  // pre-existing bulk-command test (written before the confirm step
  // existed, and which never sets `mockPrompt` itself) keeps triggering
  // the mutation as if the user confirmed. The confirm-gating tests below
  // override it per-call with `mockResolvedValueOnce`.
  mockPrompt.mockClear()
  // Same `mockClear()` reasoning as `mockPrompt` above: every test below
  // renders the full `ReadyToShipTable` (whose `ship_from` column cell now
  // reads both of these via `ShipFromSelect`), not just `mockUseOrders` -
  // so their defaults, set once below, need to survive every test rather
  // than reset to `undefined` and break destructuring in
  // `ReadyToShipTable`/`ShipFromSelect`.
  mockUseStore.mockClear()
  mockUseStockLocations.mockClear()
  // `mockClear()`, not `mockReset()`: the `mockImplementation` set once
  // below (reading from `ratesByOrder`) must survive every test.
  mockUseOrderCarrierRates.mockClear()
  ratesByOrder = {}
  setHoldLookups()
})

const setHoldLookups = (
  overrides: {
    tag?: Partial<{
      tagId: string | null
      isLoading: boolean
      isError: boolean
    }>
    held?: Partial<{ ids: string[]; isLoading: boolean; isError: boolean }>
  } = {}
) => {
  mockUseHoldTag.mockReturnValue({
    tagId: null,
    isLoading: false,
    isError: false,
    ...overrides.tag,
  })
  mockUseHeldOrderIds.mockReturnValue({
    ids: [],
    isLoading: false,
    isError: false,
    ...overrides.held,
  })
}
setHoldLookups()

mockUseOrders.mockReturnValue({
  orders: [],
  count: 0,
  isLoading: false,
  isError: false,
  error: undefined,
})

// No quote for an order with no `ratesByOrder` entry (still "loading") -
// keeps `ShippingRateSelect`'s own auto-select effect from firing for a row
// no test below has opted into a quote for; that behavior is covered on its
// own terms by `shipping-rate-select.spec.tsx`. A test that calls
// `setOrderRate` for a given order id gets that exact quote back instead.
mockUseOrderCarrierRates.mockImplementation((orderId: string) => ({
  data: ratesByOrder[orderId],
  isError: false,
  refetch: vi.fn(),
}))

mockPrompt.mockResolvedValue(true)

mockUseStore.mockReturnValue({
  store: {
    id: "store_1",
    metadata: { default_ship_from_location_id: "loc_default" },
  },
})

mockUseStockLocations.mockReturnValue({
  stock_locations: [{ id: "loc_default", name: "Warehouse A" }],
})

// jsdom doesn't implement these - Radix `Select`'s pointer-based open/select
// handling (now rendered for real as `ShipFromSelect` in every row of the
// bulk-command tests' full `ReadyToShipTable` below) calls them
// unconditionally, which would otherwise throw as soon as a trigger is
// clicked.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = vi.fn()
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn()
}

describe("ReadyToShipTable shipping rate / fulfill", () => {
  it("shows $0.00 for a free shipping method, distinct from no shipping method at all", () => {
    // order A: shipping_methods[0].amount === 0 -> renders "$0.00"
    const { unmount } = render(
      <ShippingRateCell
        shippingMethod={
          {
            id: "sm_1",
            order_id: "order_1",
            name: "Free Shipping",
            amount: 0,
            is_tax_inclusive: false,
            shipping_option_id: "so_1",
            data: null,
          } as any
        }
        currencyCode="usd"
      />
    )

    expect(screen.getByText("Free Shipping")).toBeTruthy()
    expect(screen.getByText(/0\.00/)).toBeTruthy()

    unmount()

    // order B: shipping_methods is empty -> renders empty cell, visibly
    // distinct from the $0.00 case above
    const { container } = render(
      <ShippingRateCell shippingMethod={undefined} currencyCode="usd" />
    )

    expect(container.textContent).toBe("")
    expect(screen.queryByText("Free Shipping")).toBeNull()
    expect(screen.queryByText(/0\.00/)).toBeNull()
  })

  it("renders a disabled Fulfill button with a 'No shipping method' tooltip by default - FulfillConfirmPopover wires the enabled case up itself, this component only ever renders a disabled one", async () => {
    const user = userEvent.setup()

    render(
      <TooltipProvider>
        <DisabledFulfillCell />
      </TooltipProvider>
    )

    const disabledButton = screen.getByRole("button", {
      name: "orders.readyToShip.fulfill",
    }) as HTMLButtonElement
    expect(disabledButton.disabled).toBe(true)

    await user.hover(disabledButton)

    await waitFor(() => {
      expect(
        screen.getAllByText("orders.readyToShip.noShippingMethod").length
      ).toBeGreaterThan(0)
    })
  })

  it("renders a distinct 'rate not ready' tooltip when reason is 'noRateYet' - a row with a shipping method whose quote just isn't in yet, not one with no shipping method at all", async () => {
    const user = userEvent.setup()

    render(
      <TooltipProvider>
        <DisabledFulfillCell reason="noRateYet" />
      </TooltipProvider>
    )

    const disabledButton = screen.getByRole("button", {
      name: "orders.readyToShip.fulfill",
    }) as HTMLButtonElement
    expect(disabledButton.disabled).toBe(true)

    await user.hover(disabledButton)

    await waitFor(() => {
      expect(
        screen.getAllByText("orders.readyToShip.noRateYet").length
      ).toBeGreaterThan(0)
    })
    expect(screen.queryByText("orders.readyToShip.noShippingMethod")).toBeNull()
  })
})

describe("ShipFromCell", () => {
  it("renders the resolved location name", () => {
    render(
      <ShipFromCell
        shippingMethod={
          {
            id: "sm_1",
            order_id: "order_1",
            name: "Standard Shipping",
            amount: 1000,
            is_tax_inclusive: false,
            shipping_option_id: "so_1",
            data: null,
            shipping_option: {
              service_zone: {
                fulfillment_set: {
                  location: { name: "Warehouse A" },
                },
              },
            },
          } as any
        }
      />
    )

    expect(screen.getByText("Warehouse A")).toBeTruthy()
  })

  it("renders empty when there is no shipping method - the same precondition the Shipping Rate column fails under", () => {
    const { container } = render(<ShipFromCell shippingMethod={undefined} />)

    expect(container.textContent).toBe("")
  })
})

describe("PackageCell", () => {
  it("renders 'Not set' for each missing weight/dimension field instead of a fabricated default", () => {
    render(
      <PackageCell
        items={[
          {
            id: "item_1",
            quantity: 2,
            detail: { fulfilled_quantity: 0 },
            variant: {
              weight: null,
              length: null,
              width: null,
              height: null,
            },
          } as any,
        ]}
      />
    )

    expect(
      screen.getByText("orders.readyToShip.weight: orders.readyToShip.notSet")
    ).toBeTruthy()
    expect(
      screen.getByText(
        "orders.readyToShip.notSet x orders.readyToShip.notSet x orders.readyToShip.notSet"
      )
    ).toBeTruthy()
  })

  it("renders the computed parcel when the dimensions are set", () => {
    render(
      <PackageCell
        items={[
          {
            id: "item_1",
            quantity: 2,
            detail: { fulfilled_quantity: 0 },
            variant: {
              weight: 5,
              length: 10,
              width: 20,
              height: 30,
            },
          } as any,
        ]}
      />
    )

    expect(screen.getByText("orders.readyToShip.weight: 10")).toBeTruthy()
    expect(screen.getByText("10 x 20 x 30")).toBeTruthy()
  })
})

/**
 * Direct, isolated coverage of the bulk command's own payload-building
 * logic - including the "skip a selected order with no quote yet" path,
 * which `enableRowSelection` makes unreachable through the checkbox UI in
 * the full `ReadyToShipTable` render below (a row can't be selected via the
 * checkbox at all unless it already has a `rowRates` entry), so it's
 * exercised here directly instead of left as an untested assumption.
 */
describe("buildBulkFulfillments", () => {
  it("builds one fulfillment entry per order id, preferring each order's own location override over the store-wide default", () => {
    const { fulfillments, skippedOrderIds } = buildBulkFulfillments(
      ["order_1", "order_2"],
      { order_1: "sloc_a" },
      {
        order_1: { shipmentId: "shp_a", rateId: "rate_a" },
        order_2: { shipmentId: "shp_b", rateId: "rate_b" },
      },
      "loc_default"
    )

    expect(fulfillments).toEqual([
      {
        order_id: "order_1",
        location_id: "sloc_a",
        shipment_id: "shp_a",
        rate_id: "rate_a",
      },
      {
        order_id: "order_2",
        location_id: "loc_default",
        shipment_id: "shp_b",
        rate_id: "rate_b",
      },
    ])
    expect(skippedOrderIds).toEqual([])
  })

  it("leaves location_id undefined, rather than null, when neither an override, a store default, nor a checkout location exists", () => {
    const { fulfillments } = buildBulkFulfillments(
      ["order_1"],
      {},
      { order_1: { shipmentId: "shp_a", rateId: "rate_a" } },
      null
    )

    expect(fulfillments[0].location_id).toBeUndefined()
  })

  it("falls back to the order's checkout shipping option location only when there's no override and no store default", () => {
    const orderWithCheckoutLocation = {
      id: "order_1",
      shipping_methods: [
        {
          shipping_option: {
            service_zone: {
              fulfillment_set: { location: { id: "loc_checkout" } },
            },
          },
        },
      ],
    } as any

    const withoutDefault = buildBulkFulfillments(
      ["order_1"],
      {},
      { order_1: { shipmentId: "shp_a", rateId: "rate_a" } },
      null,
      [orderWithCheckoutLocation]
    )
    expect(withoutDefault.fulfillments[0].location_id).toBe("loc_checkout")

    // The store default (and an override) still take priority over it.
    const withDefault = buildBulkFulfillments(
      ["order_1"],
      {},
      { order_1: { shipmentId: "shp_a", rateId: "rate_a" } },
      "loc_default",
      [orderWithCheckoutLocation]
    )
    expect(withDefault.fulfillments[0].location_id).toBe("loc_default")
  })

  it("skips a selected order with no quoted rate yet, reports it as skipped, and still builds the rest", () => {
    const { fulfillments, skippedOrderIds } = buildBulkFulfillments(
      ["order_1", "order_2"],
      {},
      { order_1: { shipmentId: "shp_a", rateId: "rate_a" } },
      "loc_default"
    )

    expect(fulfillments).toEqual([
      {
        order_id: "order_1",
        location_id: "loc_default",
        shipment_id: "shp_a",
        rate_id: "rate_a",
      },
    ])
    expect(skippedOrderIds).toEqual(["order_2"])
  })
})

/**
 * Review finding (re-review of the Important #1 fix above): `setRowPackage`
 * clearing `rowRates` unconditionally - even when the newly confirmed
 * package is identical to what was already selected - left a perfectly
 * fulfillable row stuck disabled, since `PackagePopover`'s own confirm
 * handlers call `onChange` unconditionally too (unlike `ShipFromSelect`'s
 * underlying Radix `Select`, which doesn't fire `onValueChange` for an
 * unchanged value). `isSamePackageSelection` is what `setRowPackage` now
 * checks before clearing - direct, isolated coverage here, with the full
 * no-op-confirm-through-the-real-UI behavior covered by
 * `ready-to-ship-table.spec.tsx`'s own integration test further down.
 */
describe("isSamePackageSelection", () => {
  it("returns true for two PackageSelections with identical fields", () => {
    expect(
      isSamePackageSelection(
        { predefinedPackage: "Card", weight: 1 },
        { predefinedPackage: "Card", weight: 1 }
      )
    ).toBe(true)
    expect(
      isSamePackageSelection(
        { weight: 5, length: 10, width: 20, height: 30 },
        { weight: 5, length: 10, width: 20, height: 30 }
      )
    ).toBe(true)
  })

  it("returns false when any field differs", () => {
    expect(
      isSamePackageSelection(
        { predefinedPackage: "Card", weight: 1 },
        { predefinedPackage: "Letter", weight: 1 }
      )
    ).toBe(false)
    expect(
      isSamePackageSelection(
        { weight: 5, length: 10, width: 20, height: 30 },
        { weight: 6, length: 10, width: 20, height: 30 }
      )
    ).toBe(false)
  })
})

/**
 * A minimal but render-complete `ReadyToShipOrder` fixture: one value for
 * every field each column in `useReadyToShipTableColumns` reads (customer,
 * shipping method -> shipping option -> service zone -> fulfillment set ->
 * location, items/variant dimensions, total, created_at), so the full
 * `ReadyToShipTable` - not just an individual cell - renders without
 * throwing or falling back to placeholder cells.
 */
const makeReadyToShipOrder = (id: string): any => ({
  id,
  display_id: Number(id.replace(/\D/g, "")) || 1,
  customer: {
    first_name: "Jane",
    last_name: "Doe",
    email: "jane@example.com",
  },
  currency_code: "usd",
  total: 1000,
  created_at: "2024-01-01T00:00:00.000Z",
  shipping_methods: [
    {
      id: `sm_${id}`,
      name: "Standard Shipping",
      amount: 500,
      shipping_option_id: `so_${id}`,
      shipping_option: {
        service_zone: {
          fulfillment_set: {
            location: { id: `loc_${id}`, name: "Warehouse A" },
          },
        },
      },
    },
  ],
  items: [
    {
      id: `item_${id}`,
      quantity: 1,
      detail: { fulfilled_quantity: 0 },
      variant: { weight: 1, length: 1, width: 1, height: 1 },
    },
  ],
})

// jsdom doesn't implement `Element.prototype.scroll` - `_DataTable`
// (`data-table-root.tsx`) calls it unconditionally on every page-index
// change, which would otherwise throw as soon as the full table (not just
// an individual cell, like the describe blocks above this one) is
// rendered.
if (!Element.prototype.scroll) {
  Element.prototype.scroll = vi.fn()
}

const renderReadyToShipTable = () =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <ReadyToShipTable />
      </TooltipProvider>
    </MemoryRouter>
  )

describe("ReadyToShipTable bulk Fulfill command", () => {
  it("renders no 'Fulfill selected' command when no rows are selected - _DataTable's own CommandBar open-gating (data-table-root.tsx:97,331-332), not duplicated in this component", () => {
    mockUseOrders.mockReturnValue({
      orders: [makeReadyToShipOrder("order_1")],
      count: 1,
      isLoading: false,
      isError: false,
      error: undefined,
    })

    renderReadyToShipTable()

    expect(screen.queryByRole("button", { name: /fulfillSelected/ })).toBeNull()
  })

  it("selecting a single row and triggering 'Fulfill selected' calls useBulkFulfillOrders's mutateAsync with that row's order id, location and quoted rate", async () => {
    mockUseOrders.mockReturnValue({
      orders: [
        makeReadyToShipOrder("order_1"),
        makeReadyToShipOrder("order_2"),
      ],
      count: 2,
      isLoading: false,
      isError: false,
      error: undefined,
    })
    setOrderRate("order_1", "shp_1", "rate_1")
    mockBulkFulfillOrders.mockResolvedValue({
      succeeded: ["order_1"],
      failed: [],
    })

    const user = userEvent.setup()
    renderReadyToShipTable()

    // index 0 is the header "select all" checkbox; data rows start at 1.
    // order_1 has a quoted rate (`setOrderRate` above) so its checkbox is
    // selectable; order_2's isn't.
    const checkboxes = await screen.findAllByRole("checkbox")
    await user.click(checkboxes[1])

    const fulfillSelected = await screen.findByRole("button", {
      name: /fulfillSelected/,
    })
    await user.click(fulfillSelected)

    await waitFor(() => {
      expect(mockBulkFulfillOrders).toHaveBeenCalledWith({
        fulfillments: [
          {
            order_id: "order_1",
            location_id: "loc_default",
            shipment_id: "shp_1",
            rate_id: "rate_1",
          },
        ],
      })
    })
    expect(mockBulkFulfillOrders).toHaveBeenCalledTimes(1)
  })

  it("selecting multiple rows calls mutateAsync with exactly the selected rows' fulfillments", async () => {
    mockUseOrders.mockReturnValue({
      orders: [
        makeReadyToShipOrder("order_1"),
        makeReadyToShipOrder("order_2"),
        makeReadyToShipOrder("order_3"),
      ],
      count: 3,
      isLoading: false,
      isError: false,
      error: undefined,
    })
    setOrderRate("order_1", "shp_1", "rate_1")
    setOrderRate("order_2", "shp_2", "rate_2")
    mockBulkFulfillOrders.mockResolvedValue({
      succeeded: ["order_1", "order_2"],
      failed: [],
    })

    const user = userEvent.setup()
    renderReadyToShipTable()

    // Re-queried between clicks (rather than reusing one stale snapshot of
    // `getAllByRole`), since selecting the first row re-renders the table.
    await user.click((await screen.findAllByRole("checkbox"))[1])
    await user.click((await screen.findAllByRole("checkbox"))[2])

    const fulfillSelected = await screen.findByRole("button", {
      name: /fulfillSelected/,
    })
    await user.click(fulfillSelected)

    await waitFor(() => {
      expect(mockBulkFulfillOrders).toHaveBeenCalledTimes(1)
    })
    const call = mockBulkFulfillOrders.mock.calls[0][0]
    expect(
      [...call.fulfillments].sort((a: any, b: any) =>
        a.order_id.localeCompare(b.order_id)
      )
    ).toEqual([
      {
        order_id: "order_1",
        location_id: "loc_default",
        shipment_id: "shp_1",
        rate_id: "rate_1",
      },
      {
        order_id: "order_2",
        location_id: "loc_default",
        shipment_id: "shp_2",
        rate_id: "rate_2",
      },
    ])
  })

  it("sends each selected row's own Ship From override and quoted rate on Fulfill Selected, not just the store default", async () => {
    mockUseOrders.mockReturnValue({
      orders: [
        makeReadyToShipOrder("order_1"),
        makeReadyToShipOrder("order_2"),
      ],
      count: 2,
      isLoading: false,
      isError: false,
      error: undefined,
    })
    mockUseStockLocations.mockReturnValue({
      stock_locations: [
        { id: "loc_default", name: "Warehouse A" },
        { id: "sloc_a", name: "Warehouse A2" },
        { id: "sloc_b", name: "Warehouse B2" },
      ],
    })
    mockBulkFulfillOrders.mockResolvedValue({
      succeeded: ["order_1", "order_2"],
      failed: [],
    })

    const user = userEvent.setup()
    renderReadyToShipTable()

    // Give each row its own Ship From override via the real `ShipFromSelect`
    // rendered in the `ship_from` column - targeted by its order-specific
    // `aria-label` (`ship-from-select.tsx`), not by combobox index, since
    // the `shipping_rate` column's `ShippingRateSelect` is also a
    // "combobox" and would otherwise throw off the indices.
    //
    // Each `setOrderRate` call here, right before its row's own Ship From
    // click, stands in for the fresh quote `ShippingRateSelect` would get
    // back from a real re-quote against the *new* location (its own
    // `rowRates` entry for this order is cleared the instant the override
    // itself changes - see `clearRowRate` in `ready-to-ship-table.tsx` -
    // and only repopulated once a quote for the new location actually
    // resolves, which this simulates).
    setOrderRate("order_1", "shp_a", "rate_a")
    await user.click(
      await screen.findByRole("combobox", { name: "Ship from - order order_1" })
    )
    await user.click(await screen.findByText("Warehouse A2"))

    setOrderRate("order_2", "shp_b", "rate_b")
    await user.click(
      screen.getByRole("combobox", { name: "Ship from - order order_2" })
    )
    await user.click(await screen.findByText("Warehouse B2"))

    await user.click((await screen.findAllByRole("checkbox"))[1])
    await user.click((await screen.findAllByRole("checkbox"))[2])

    const fulfillSelected = await screen.findByRole("button", {
      name: /fulfillSelected/,
    })
    await user.click(fulfillSelected)

    await waitFor(() => {
      expect(mockBulkFulfillOrders).toHaveBeenCalledTimes(1)
    })
    const call = mockBulkFulfillOrders.mock.calls[0][0]
    expect(
      [...call.fulfillments].sort((a: any, b: any) =>
        a.order_id.localeCompare(b.order_id)
      )
    ).toEqual([
      {
        order_id: "order_1",
        location_id: "sloc_a",
        shipment_id: "shp_a",
        rate_id: "rate_a",
      },
      {
        order_id: "order_2",
        location_id: "sloc_b",
        shipment_id: "shp_b",
        rate_id: "rate_b",
      },
    ])
  })

  it("on a successful mutation, passes the exact structured { succeeded, failed } result to BulkFulfillResultSummary, and dismissing it removes it from the DOM", async () => {
    mockUseOrders.mockReturnValue({
      orders: [makeReadyToShipOrder("order_1")],
      count: 1,
      isLoading: false,
      isError: false,
      error: undefined,
    })
    setOrderRate("order_1", "shp_1", "rate_1")
    const result = {
      succeeded: ["order_1"],
      failed: [
        { order_id: "order_2", error: "Unable to buy a shipping label" },
      ],
    }
    mockBulkFulfillOrders.mockResolvedValue(result)

    const user = userEvent.setup()
    renderReadyToShipTable()

    const checkboxes = await screen.findAllByRole("checkbox")
    await user.click(checkboxes[1])
    await user.click(
      await screen.findByRole("button", { name: /fulfillSelected/ })
    )

    const summary = await screen.findByTestId("bulk-fulfill-result-summary")

    expect(mockBulkFulfillResultSummary).toHaveBeenCalledWith(
      expect.objectContaining({ result })
    )
    expect(summary.textContent).toContain("succeeded:order_1")
    expect(summary.textContent).toContain(
      "failed:order_2:Unable to buy a shipping label"
    )

    await user.click(within(summary).getByRole("button", { name: "dismiss" }))

    expect(screen.queryByTestId("bulk-fulfill-result-summary")).toBeNull()
  })

  it("on a request-level failure (the mutation's promise rejecting, not a per-order failure in a successful response), shows a toast and never renders BulkFulfillResultSummary", async () => {
    mockUseOrders.mockReturnValue({
      orders: [makeReadyToShipOrder("order_1")],
      count: 1,
      isLoading: false,
      isError: false,
      error: undefined,
    })
    setOrderRate("order_1", "shp_1", "rate_1")
    mockBulkFulfillOrders.mockRejectedValue(new Error("Network request failed"))

    const user = userEvent.setup()
    renderReadyToShipTable()

    const checkboxes = await screen.findAllByRole("checkbox")
    await user.click(checkboxes[1])
    await user.click(
      await screen.findByRole("button", { name: /fulfillSelected/ })
    )

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("Network request failed")
    })

    expect(screen.queryByTestId("bulk-fulfill-result-summary")).toBeNull()
    expect(mockBulkFulfillResultSummary).not.toHaveBeenCalled()
  })

  it("shows a confirm prompt naming the selected order count before fulfilling, and declining it never calls mutateAsync - each fulfillment buys a real shipping label", async () => {
    mockUseOrders.mockReturnValue({
      orders: [
        makeReadyToShipOrder("order_1"),
        makeReadyToShipOrder("order_2"),
      ],
      count: 2,
      isLoading: false,
      isError: false,
      error: undefined,
    })
    setOrderRate("order_1", "shp_1", "rate_1")
    setOrderRate("order_2", "shp_2", "rate_2")
    mockPrompt.mockResolvedValueOnce(false)

    const user = userEvent.setup()
    renderReadyToShipTable()

    await user.click((await screen.findAllByRole("checkbox"))[1])
    await user.click((await screen.findAllByRole("checkbox"))[2])

    const fulfillSelected = await screen.findByRole("button", {
      name: /fulfillSelected/,
    })
    await user.click(fulfillSelected)

    await waitFor(() => {
      expect(mockPrompt).toHaveBeenCalledWith({
        title: "general.areYouSure",
        description: `orders.readyToShip.fulfillSelectedConfirmDescription:{"count":2}`,
        confirmText: "actions.continue",
        cancelText: "actions.cancel",
      })
    })

    expect(mockBulkFulfillOrders).not.toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it("triggering the command a second time while the first hasn't settled is a no-op - it never fires a second, overlapping request for the same selection", async () => {
    mockUseOrders.mockReturnValue({
      orders: [makeReadyToShipOrder("order_1")],
      count: 1,
      isLoading: false,
      isError: false,
      error: undefined,
    })
    setOrderRate("order_1", "shp_1", "rate_1")

    let resolveBulkFulfill: (value: any) => void = () => {}
    mockBulkFulfillOrders.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBulkFulfill = resolve
        })
    )

    const user = userEvent.setup()
    renderReadyToShipTable()

    await user.click((await screen.findAllByRole("checkbox"))[1])

    // First click: confirms (the default `mockPrompt` resolution) and
    // starts the still-pending mutation.
    await user.click(
      await screen.findByRole("button", { name: /fulfillSelected/ })
    )
    await waitFor(() => {
      expect(mockBulkFulfillOrders).toHaveBeenCalledTimes(1)
    })

    // Second click while the first batch hasn't settled: the
    // `isBulkFulfilling` guard must make this a no-op, not a second
    // overlapping request for the same orders.
    await user.click(screen.getByRole("button", { name: /fulfillSelected/ }))
    expect(mockBulkFulfillOrders).toHaveBeenCalledTimes(1)
    expect(mockPrompt).toHaveBeenCalledTimes(1)

    resolveBulkFulfill({ succeeded: ["order_1"], failed: [] })

    await waitFor(() => {
      expect(screen.queryByTestId("bulk-fulfill-result-summary")).toBeTruthy()
    })
  })
})

/**
 * Regression coverage for the final-review Finding 1: `_DataTable`
 * (`data-table-root.tsx`) wraps every non-`select` cell - including the
 * `fulfill` column - in a react-router `Link` to `navigateTo`'s target
 * whenever one is configured, which `ReadyToShipTable` does (to the order
 * detail page). Unlike `fulfill-confirm-popover.spec.tsx`, which renders
 * `FulfillConfirmPopover` in isolation with no surrounding `Link` at all,
 * this renders the real, fully composed `ReadyToShipTable` under an actual
 * `/orders` + `/orders/:id` router so a click that bubbles to that `Link`
 * actually navigates, the way it would have in the real app.
 */
describe("ReadyToShipTable Fulfill popover - composed tree (regression)", () => {
  const renderComposedReadyToShipTable = () =>
    render(
      <MemoryRouter initialEntries={["/orders"]}>
        <TooltipProvider>
          <Routes>
            <Route path="/orders" element={<ReadyToShipTable />} />
            <Route
              path="/orders/:id"
              element={<div data-testid="order-detail-page">detail</div>}
            />
          </Routes>
        </TooltipProvider>
      </MemoryRouter>
    )

  it("clicking the row's Fulfill button opens the confirm popover instead of navigating to the order detail page", async () => {
    mockUseOrders.mockReturnValue({
      orders: [makeReadyToShipOrder("order_1")],
      count: 1,
      isLoading: false,
      isError: false,
      error: undefined,
    })
    // `FulfillConfirmPopover`'s own guard (Task 13) requires a quoted rate
    // to be on hand before it renders the real button instead of
    // `DisabledFulfillCell` - without this, there'd be no enabled button to
    // click here at all.
    setOrderRate("order_1", "shp_order_1", "rate_order_1")

    const user = userEvent.setup()
    renderComposedReadyToShipTable()

    await user.click(
      await screen.findByRole("button", { name: "orders.readyToShip.fulfill" })
    )

    expect(
      await screen.findByText("orders.readyToShip.confirmHeading")
    ).toBeTruthy()
    expect(screen.queryByTestId("order-detail-page")).toBeNull()
  })

  it("clicking Confirm inside the popover fulfills the order and stays on the list - it never reaches the row's Link", async () => {
    mockUseOrders.mockReturnValue({
      orders: [makeReadyToShipOrder("order_1")],
      count: 1,
      isLoading: false,
      isError: false,
      error: undefined,
    })
    setOrderRate("order_1", "shp_order_1", "rate_order_1")
    mockBulkFulfillOrders.mockResolvedValue({
      succeeded: ["order_1"],
      failed: [],
    })

    const user = userEvent.setup()
    renderComposedReadyToShipTable()

    await user.click(
      await screen.findByRole("button", { name: "orders.readyToShip.fulfill" })
    )
    await screen.findByText("orders.readyToShip.confirmHeading")

    await user.click(screen.getByRole("button", { name: "actions.confirm" }))

    // `FulfillConfirmPopover` now fulfills via `useBulkFulfillOrders` (a
    // one-item `fulfillments` array), not `useCreateOrderFulfillment` - the
    // same mutation the bulk "Fulfill selected" command itself calls. The
    // location sent is the store-wide default (`loc_default`, from
    // `mockUseStore` above) - not `order_1`'s own shipping method location
    // (`loc_order_1`) - since no Ship From override is set for this row;
    // `FulfillConfirmPopover` resolves `location_id` exactly the same way
    // `buildBulkFulfillments` does for the bulk path.
    await waitFor(() => {
      expect(mockBulkFulfillOrders).toHaveBeenCalledWith({
        fulfillments: [
          {
            order_id: "order_1",
            location_id: "loc_default",
            shipment_id: "shp_order_1",
            rate_id: "rate_order_1",
          },
        ],
      })
    })

    // Still on the list route, not navigated to the order detail page.
    expect(screen.queryByTestId("order-detail-page")).toBeNull()
    expect(
      screen.getByRole("button", { name: "orders.readyToShip.fulfill" })
    ).toBeTruthy()
  })
})

/**
 * Regression coverage for the final-review Finding 4: the single-row
 * Fulfill button is already disabled for an order with no shipping
 * method (`DisabledFulfillCell`), but the bulk row-selection checkbox had
 * no equivalent guard - a user could select such an order via the
 * checkbox and it would only fail once the batch ran, server-side.
 */
describe("ReadyToShipTable bulk row selection - no shipping method guard", () => {
  it("disables the row checkbox for an order with no shipping method, matching the single-row Fulfill button's own guard", async () => {
    mockUseOrders.mockReturnValue({
      orders: [
        makeReadyToShipOrder("order_1"),
        { ...makeReadyToShipOrder("order_2"), shipping_methods: [] },
      ],
      count: 2,
      isLoading: false,
      isError: false,
      error: undefined,
    })
    // order_1 also needs a quoted rate (Task 13's own gate) to isolate what
    // this test actually covers - the shipping-method guard, not the rate
    // one.
    setOrderRate("order_1", "shp_1", "rate_1")

    renderReadyToShipTable()

    // index 0: header "select all" checkbox; 1: order_1 (has a shipping
    // method); 2: order_2 (none).
    const [, order1Checkbox, order2Checkbox] = (await screen.findAllByRole(
      "checkbox"
    )) as HTMLButtonElement[]

    expect(order1Checkbox.disabled).toBe(false)
    expect(order2Checkbox.disabled).toBe(true)
  })

  it("the header 'select all' checkbox only selects rows with a shipping method, so a bulk fulfill never includes the unselectable order", async () => {
    mockUseOrders.mockReturnValue({
      orders: [
        makeReadyToShipOrder("order_1"),
        { ...makeReadyToShipOrder("order_2"), shipping_methods: [] },
      ],
      count: 2,
      isLoading: false,
      isError: false,
      error: undefined,
    })
    setOrderRate("order_1", "shp_1", "rate_1")
    mockBulkFulfillOrders.mockResolvedValue({
      succeeded: ["order_1"],
      failed: [],
    })

    const user = userEvent.setup()
    renderReadyToShipTable()

    const [selectAll] = await screen.findAllByRole("checkbox")
    await user.click(selectAll)

    await user.click(
      await screen.findByRole("button", { name: /fulfillSelected/ })
    )

    await waitFor(() => {
      expect(mockBulkFulfillOrders).toHaveBeenCalledWith({
        fulfillments: [
          {
            order_id: "order_1",
            location_id: "loc_default",
            shipment_id: "shp_1",
            rate_id: "rate_1",
          },
        ],
      })
    })
  })
})

/**
 * Task 10 coverage for the `ship_from` column's wiring: `ShipFromSelect`
 * itself (defaulting, calling `onChange` immediately) is covered in
 * isolation by `ship-from-select.spec.tsx` - this exercises the part that
 * lives in `ReadyToShipTable` itself: resolving the store-wide default via
 * `useStore`, and keeping each row's override independent in
 * `rowLocationOverride`.
 */
describe("ReadyToShipTable Ship From column", () => {
  it("defaults every row with no override yet to the store's default_ship_from_location_id", async () => {
    mockUseOrders.mockReturnValue({
      orders: [
        makeReadyToShipOrder("order_1"),
        makeReadyToShipOrder("order_2"),
      ],
      count: 2,
      isLoading: false,
      isError: false,
      error: undefined,
    })

    renderReadyToShipTable()

    expect(await screen.findAllByText("Warehouse A")).toHaveLength(2)
  })

  it("picking a different Ship From location on one row only overrides that row - the other row keeps the store default", async () => {
    mockUseOrders.mockReturnValue({
      orders: [
        makeReadyToShipOrder("order_1"),
        makeReadyToShipOrder("order_2"),
      ],
      count: 2,
      isLoading: false,
      isError: false,
      error: undefined,
    })
    mockUseStockLocations.mockReturnValue({
      stock_locations: [
        { id: "loc_default", name: "Warehouse A" },
        { id: "loc_b", name: "Warehouse B" },
      ],
    })

    const user = userEvent.setup()
    renderReadyToShipTable()

    const triggers = await screen.findAllByRole("combobox")
    await user.click(triggers[0])
    await user.click(await screen.findByText("Warehouse B"))

    // The first row switched to the newly picked location; the second
    // row's trigger - untouched - still shows the store default.
    expect(screen.getByText("Warehouse B")).toBeTruthy()
    expect(screen.getByText("Warehouse A")).toBeTruthy()
  })

  it("with no store default configured, shows - and quotes against - the order's checkout shipping option location instead of failing every row", async () => {
    mockUseStore.mockReturnValue({ store: { id: "store_1", metadata: {} } })
    mockUseOrders.mockReturnValue({
      orders: [makeReadyToShipOrder("order_1")],
      count: 1,
      isLoading: false,
      isError: false,
      error: undefined,
    })
    mockUseStockLocations.mockReturnValue({
      stock_locations: [{ id: "loc_order_1", name: "Checkout Warehouse" }],
    })

    try {
      renderReadyToShipTable()

      expect(await screen.findByText("Checkout Warehouse")).toBeTruthy()
      expect(mockUseOrderCarrierRates).toHaveBeenCalledWith(
        "order_1",
        expect.objectContaining({ location_id: "loc_order_1" })
      )
      expect(
        screen.queryByText("orders.readyToShip.noShipFromLocation")
      ).toBeNull()
    } finally {
      mockUseStore.mockReturnValue({
        store: {
          id: "store_1",
          metadata: { default_ship_from_location_id: "loc_default" },
        },
      })
      mockUseStockLocations.mockReturnValue({
        stock_locations: [{ id: "loc_default", name: "Warehouse A" }],
      })
    }
  })

  it("shows an actionable 'set a default ship-from location' message when nothing at all resolves a location", async () => {
    mockUseStore.mockReturnValue({ store: { id: "store_1", metadata: {} } })
    const order = makeReadyToShipOrder("order_1")
    order.shipping_methods[0].shipping_option = null
    mockUseOrders.mockReturnValue({
      orders: [order],
      count: 1,
      isLoading: false,
      isError: false,
      error: undefined,
    })

    try {
      renderReadyToShipTable()

      expect(
        await screen.findByText("orders.readyToShip.noShipFromLocation")
      ).toBeTruthy()
    } finally {
      mockUseStore.mockReturnValue({
        store: {
          id: "store_1",
          metadata: { default_ship_from_location_id: "loc_default" },
        },
      })
    }
  })
})

describe("ReadyToShipTable Package column across a row remount", () => {
  it("still shows the row's confirmed package after its row unmounts and remounts (e.g. paging away and back) - the same package it's quoted with", async () => {
    const pageWithOrder = {
      orders: [makeReadyToShipOrder("order_1")],
      count: 1,
      isLoading: false,
      isError: false,
      error: undefined,
    }
    mockUseOrders.mockReturnValue(pageWithOrder)

    const user = userEvent.setup()
    const { rerender } = renderReadyToShipTable()

    await user.click(screen.getByRole("button", { name: "Custom — 1x1x1, 1" }))
    await user.click(
      await screen.findByRole("radio", {
        name: "USPS Card (6in x 4.5in x 0.016in)",
      })
    )
    await user.click(screen.getByRole("button", { name: "actions.confirm" }))
    expect(
      screen.getByRole("button", { name: "USPS Card (6in x 4.5in x 0.016in)" })
    ).toBeTruthy()

    // "Page away": the row unmounts...
    mockUseOrders.mockReturnValue({ ...pageWithOrder, orders: [], count: 1 })
    rerender(
      <MemoryRouter>
        <TooltipProvider>
          <ReadyToShipTable />
        </TooltipProvider>
      </MemoryRouter>
    )
    expect(
      screen.queryByRole("button", { name: "USPS Card (6in x 4.5in x 0.016in)" })
    ).toBeNull()

    // ...and "page back": a brand new PackagePopover instance mounts.
    mockUseOrders.mockReturnValue(pageWithOrder)
    rerender(
      <MemoryRouter>
        <TooltipProvider>
          <ReadyToShipTable />
        </TooltipProvider>
      </MemoryRouter>
    )

    expect(
      await screen.findByRole("button", {
        name: "USPS Card (6in x 4.5in x 0.016in)",
      })
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Custom — 1x1x1, 1" })).toBeNull()
    // And it's the package the row is quoted with.
    expect(mockUseOrderCarrierRates).toHaveBeenLastCalledWith(
      "order_1",
      expect.objectContaining({
        parcel: expect.objectContaining({ predefinedPackage: "Card" }),
      })
    )
  })
})

/**
 * Review finding (Important #2 of the Task 13 re-review): `rowRates` was
 * never cleared when a row's Ship From or Package selection changed, so a
 * *stale* rate - quoted against the previous location/parcel - kept
 * gating `enableRowSelection`/`FulfillConfirmPopover` open for the entire
 * window between "the location/package changed" and "the new quote
 * resolves". A fulfillment confirmed in that window would buy a label
 * whose EasyPost shipment no longer matches what's actually being sent.
 * `ready-to-ship-table.tsx`'s `clearRowRate` (called from
 * `setRowLocationOverride`/`setRowPackage`) fixes this by clearing the
 * row's `rowRates` entry the instant either selection changes, re-disabling
 * the row until a fresh quote for the new location/parcel actually
 * resolves.
 */
describe("ReadyToShipTable rate invalidation on Ship From/Package change", () => {
  it("clears the row's quoted rate - disabling it again - the instant the admin changes that row's Ship From, since the old rate was quoted against the previous location", async () => {
    mockUseOrders.mockReturnValue({
      orders: [makeReadyToShipOrder("order_1")],
      count: 1,
      isLoading: false,
      isError: false,
      error: undefined,
    })
    mockUseStockLocations.mockReturnValue({
      stock_locations: [
        { id: "loc_default", name: "Warehouse A" },
        { id: "sloc_a", name: "Warehouse A2" },
      ],
    })
    setOrderRate("order_1", "shp_1", "rate_1")

    const user = userEvent.setup()
    renderReadyToShipTable()

    const checkboxBefore = (await screen.findAllByRole(
      "checkbox"
    ))[1] as HTMLButtonElement
    expect(checkboxBefore.disabled).toBe(false)

    await user.click(
      screen.getByRole("combobox", { name: "Ship from - order order_1" })
    )
    await user.click(await screen.findByText("Warehouse A2"))

    // No new quote was simulated for the new location (unlike the
    // integration test above, which calls `setOrderRate` again before the
    // click to stand in for one) - `ShippingRateSelect`'s own `data` is
    // therefore unchanged, so its auto-select guard correctly does *not*
    // repopulate `rowRates` here. The row stays disabled until a genuinely
    // new quote arrives, exactly the gap this fix closes.
    const checkboxAfter = (await screen.findAllByRole(
      "checkbox"
    ))[1] as HTMLButtonElement
    expect(checkboxAfter.disabled).toBe(true)
  })

  it("clears the row's quoted rate - disabling it again - the instant the admin confirms a different Package selection, since the old rate was quoted against the previous parcel", async () => {
    mockUseOrders.mockReturnValue({
      orders: [makeReadyToShipOrder("order_1")],
      count: 1,
      isLoading: false,
      isError: false,
      error: undefined,
    })
    setOrderRate("order_1", "shp_1", "rate_1")

    const user = userEvent.setup()
    renderReadyToShipTable()

    const checkboxBefore = (await screen.findAllByRole(
      "checkbox"
    ))[1] as HTMLButtonElement
    expect(checkboxBefore.disabled).toBe(false)

    // `makeReadyToShipOrder`'s single item has `variant: { weight: 1,
    // length: 1, width: 1, height: 1 }`, so `PackagePopover`'s trigger -
    // nothing confirmed yet - reads "Custom — 1x1x1, 1".
    await user.click(
      screen.getByRole("button", { name: "Custom — 1x1x1, 1" })
    )
    await user.click(
      await screen.findByRole("radio", {
        name: "USPS Card (6in x 4.5in x 0.016in)",
      })
    )
    await user.click(screen.getByRole("button", { name: "actions.confirm" }))

    const checkboxAfter = (await screen.findAllByRole(
      "checkbox"
    ))[1] as HTMLButtonElement
    expect(checkboxAfter.disabled).toBe(true)
  })

  it("confirming the Package popover with the same values as before does not disable the row's fulfill checkbox/button - only a genuinely different package selection should re-gate fulfillment", async () => {
    mockUseOrders.mockReturnValue({
      orders: [makeReadyToShipOrder("order_1")],
      count: 1,
      isLoading: false,
      isError: false,
      error: undefined,
    })
    setOrderRate("order_1", "shp_1", "rate_1")

    const user = userEvent.setup()
    renderReadyToShipTable()

    // Give the row an explicit Package selection (away from the computed
    // default), and simulate the fresh quote that follows a real re-quote
    // against it - same as the "confirms a different Package selection"
    // test above.
    await user.click(
      screen.getByRole("button", { name: "Custom — 1x1x1, 1" })
    )
    await user.click(
      await screen.findByRole("radio", {
        name: "USPS Card (6in x 4.5in x 0.016in)",
      })
    )
    setOrderRate("order_1", "shp_card", "rate_card")
    await user.click(screen.getByRole("button", { name: "actions.confirm" }))

    const checkboxAfterFirstConfirm = (await screen.findAllByRole(
      "checkbox"
    ))[1] as HTMLButtonElement
    expect(checkboxAfterFirstConfirm.disabled).toBe(false)

    // Reopen the same popover - its trigger now reads the confirmed
    // preset's own label - and confirm again with no changes at all.
    // `PackagePopover`'s own confirm handlers call `onChange`
    // unconditionally either way, so this only stays enabled if
    // `setRowPackage` itself recognizes the value is unchanged and skips
    // clearing the rate (no second `setOrderRate` call here - there's
    // nothing new to quote, and there must not need to be).
    await user.click(
      screen.getByRole("button", { name: "USPS Card (6in x 4.5in x 0.016in)" })
    )
    await user.click(screen.getByRole("button", { name: "actions.confirm" }))

    const checkboxAfterSecondConfirm = (await screen.findAllByRole(
      "checkbox"
    ))[1] as HTMLButtonElement
    expect(checkboxAfterSecondConfirm.disabled).toBe(false)
  })

  it("confirming the Package popover's default Custom state unchanged - a row's very first confirm, with no prior explicit selection at all - does not disable the row's fulfill checkbox/button either", async () => {
    mockUseOrders.mockReturnValue({
      orders: [makeReadyToShipOrder("order_1")],
      count: 1,
      isLoading: false,
      isError: false,
      error: undefined,
    })
    setOrderRate("order_1", "shp_1", "rate_1")

    const user = userEvent.setup()
    renderReadyToShipTable()

    const checkboxBefore = (await screen.findAllByRole(
      "checkbox"
    ))[1] as HTMLButtonElement
    expect(checkboxBefore.disabled).toBe(false)

    // Opens and confirms the Package popover without touching anything -
    // this row has never had an explicit selection before, so
    // `rowPackages[orderId]` is still undefined going in. The popover
    // always opens pre-filled from the order's own computed parcel
    // (`makeReadyToShipOrder`'s item: weight/length/width/height all 1,
    // hence "Custom — 1x1x1, 1"), and confirming it unchanged sends back
    // that exact same parcel - the same one `rowRates` was already quoted
    // against. `setRowPackage`'s `!previous` branch alone would wrongly
    // treat this as "changed" (there's no *prior explicit* selection to
    // compare against) without falling back to that same computed
    // baseline for the comparison.
    await user.click(
      screen.getByRole("button", { name: "Custom — 1x1x1, 1" })
    )
    await user.click(screen.getByRole("button", { name: "actions.confirm" }))

    const checkboxAfter = (await screen.findAllByRole(
      "checkbox"
    ))[1] as HTMLButtonElement
    expect(checkboxAfter.disabled).toBe(false)
  })
})

const EMPTY_ORDERS = {
  orders: [],
  count: 0,
  isLoading: false,
  isError: false,
  error: undefined,
}

describe("ReadyToShipTable view query / held-order exclusion", () => {
  it("Ready to Ship query excludes held ids and matches getViewQuery", () => {
    mockUseOrders.mockReturnValue(EMPTY_ORDERS)
    setHoldLookups({
      tag: { tagId: "tag_hold" },
      held: { ids: ["order_held_1", "order_held_2"] },
    })

    renderReadyToShipTable()

    const [params, options] = mockUseOrders.mock.calls.at(-1)!
    expect(params).toMatchObject({
      fulfillment_status: ["not_fulfilled", "partially_fulfilled"],
      payment_status: ["captured", "partially_captured"],
      status: { $nin: ["canceled"] },
      id: { $nin: ["order_held_1", "order_held_2"] },
      limit: 20,
      offset: 0,
      order: "-created_at",
    })
    expect(options.enabled).toBe(true)
  })

  it("does not fetch while the hold tag or held ids are still loading", () => {
    mockUseOrders.mockReturnValue(EMPTY_ORDERS)
    setHoldLookups({ held: { isLoading: true } })

    renderReadyToShipTable()

    const [, options] = mockUseOrders.mock.calls.at(-1)!
    expect(options.enabled).toBe(false)
  })

  it("throws to the error boundary (and does not fetch) when the held-order lookup failed", () => {
    setHoldLookups({ held: { isError: true } })
    mockUseOrders.mockReturnValue(EMPTY_ORDERS)
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})

    expect(() => renderReadyToShipTable()).toThrow()
    expect(mockUseOrders.mock.calls.at(-1)![1].enabled).toBe(false)

    spy.mockRestore()
  })

  it("throws when the hold tag lookup failed", () => {
    setHoldLookups({ tag: { isError: true } })
    mockUseOrders.mockReturnValue(EMPTY_ORDERS)
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})

    expect(() => renderReadyToShipTable()).toThrow()

    spy.mockRestore()
  })
})

describe("buildBulkFulfillments no_notification", () => {
  it("sends no_notification: true only for orders whose email toggle is off", () => {
    const { fulfillments } = buildBulkFulfillments(
      ["order_1", "order_2"],
      {},
      {
        order_1: { shipmentId: "shp_1", rateId: "rate_1" },
        order_2: { shipmentId: "shp_2", rateId: "rate_2" },
      },
      "loc_default",
      [],
      { order_1: false, order_2: true }
    )

    expect(fulfillments[0]).toEqual({
      order_id: "order_1",
      location_id: "loc_default",
      shipment_id: "shp_1",
      rate_id: "rate_1",
      no_notification: true,
    })
    expect("no_notification" in fulfillments[1]).toBe(false)
  })
})

describe("ReadyToShipTable alerts, channel, due, delivery, email and tags", () => {
  const richOrder = (id: string, overrides: Record<string, unknown> = {}) => ({
    ...makeReadyToShipOrder(id),
    payment_status: "captured",
    sales_channel: { name: "Amazon", metadata: { handling_hours: 24 } },
    tags: [{ id: `tag_${id}`, value: `tag-${id}` }],
    // far in the future so the order is not overdue
    created_at: "2999-01-01T00:00:00.000Z",
    ...overrides,
  })

  const overdueOrder = (id: string) =>
    richOrder(id, { created_at: "2020-01-01T00:00:00.000Z" })

  const setOrders = (orders: unknown[]) =>
    mockUseOrders.mockReturnValue({
      orders,
      count: orders.length,
      isLoading: false,
      isError: false,
      error: undefined,
    })

  it("renders channel, delivery and tags cells for each row", async () => {
    setOrders([richOrder("order_1")])

    renderReadyToShipTable()

    expect(await screen.findByText("Amazon")).toBeTruthy()
    expect(screen.getAllByText("Standard Shipping").length).toBeGreaterThan(0)
    expect(screen.getByText("tag-order_1")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "orders.tags.addToOrder" })
    ).toBeTruthy()
  })

  it("places the new columns after Customer and around Ship Time as specified", async () => {
    setOrders([richOrder("order_1")])

    renderReadyToShipTable()
    await screen.findByText("Amazon")

    const headers = screen
      .getAllByRole("columnheader")
      .map((h) => h.textContent ?? "")
    const idx = (needle: string) => headers.findIndex((h) => h.includes(needle))

    expect(idx("orders.readyToShip.alerts.header")).toBeGreaterThan(-1)
    expect(idx("orders.readyToShip.channel")).toBe(
      idx("orders.readyToShip.alerts.header") + 1
    )
    expect(idx("orders.readyToShip.due.header")).toBe(
      idx("orders.readyToShip.shipTime") + 1
    )
    expect(idx("orders.readyToShip.delivery")).toBe(
      idx("orders.readyToShip.due.header") + 1
    )
    expect(idx("orders.readyToShip.emailToggle")).toBe(
      idx("orders.readyToShip.delivery") + 1
    )
    expect(idx("orders.readyToShip.tagsHeader")).toBe(
      idx("orders.readyToShip.emailToggle") + 1
    )
  })

  it("highlights a row that has alerts", async () => {
    setOrders([
      richOrder("order_1", {
        items: [
          {
            id: "i1",
            quantity: 1,
            detail: { fulfilled_quantity: 0 },
            variant: { weight: null },
          },
        ],
      }),
    ])

    renderReadyToShipTable()

    const marker = await screen.findByTestId("order-alerts")
    const row = marker.closest("tr")!
    expect(row.className).toContain("has-[[data-row-alert]]")
  })

  it("shows the overdue banner count and filters to overdue rows on click", async () => {
    setOrders([
      richOrder("order_1"),
      overdueOrder("order_2"),
      overdueOrder("order_3"),
    ])
    const user = userEvent.setup()

    renderReadyToShipTable()

    const banner = await screen.findByRole("button", {
      name: /overdueBanner/,
    })
    expect(banner.textContent).toContain(`"count":2`)
    expect(screen.getByText("tag-order_1")).toBeTruthy()

    await user.click(banner)

    expect(screen.queryByText("tag-order_1")).toBeNull()
    expect(screen.getByText("tag-order_2")).toBeTruthy()
    expect(screen.getByText("tag-order_3")).toBeTruthy()

    await user.click(banner)
    expect(screen.getByText("tag-order_1")).toBeTruthy()
  })

  it("hides the overdue banner when nothing is overdue", async () => {
    setOrders([richOrder("order_1")])

    renderReadyToShipTable()
    await screen.findByText("Amazon")

    expect(screen.queryByRole("button", { name: /overdueBanner/ })).toBeNull()
  })

  it("turning one row's email toggle off sends no_notification true for that order only, in the bulk call", async () => {
    setOrders([richOrder("order_1"), richOrder("order_2")])
    setOrderRate("order_1", "shp_1", "rate_1")
    setOrderRate("order_2", "shp_2", "rate_2")
    mockBulkFulfillOrders.mockResolvedValue({ succeeded: [], failed: [] })
    const user = userEvent.setup()

    renderReadyToShipTable()

    const switches = await screen.findAllByRole("switch")
    expect(
      switches.every((s) => s.getAttribute("aria-checked") === "true")
    ).toBe(true)
    await user.click(switches[0])
    expect(switches[0].getAttribute("aria-checked")).toBe("false")

    // index 0 is the header "select all" checkbox.
    const checkboxes = await screen.findAllByRole("checkbox")
    await user.click(checkboxes[0])
    await user.click(
      await screen.findByRole("button", { name: /fulfillSelected/ })
    )

    await waitFor(() => {
      expect(mockBulkFulfillOrders).toHaveBeenCalledWith({
        fulfillments: [
          {
            order_id: "order_1",
            location_id: "loc_default",
            shipment_id: "shp_1",
            rate_id: "rate_1",
            no_notification: true,
          },
          {
            order_id: "order_2",
            location_id: "loc_default",
            shipment_id: "shp_2",
            rate_id: "rate_2",
          },
        ],
      })
    })
  })

  it("the single-row Fulfill passes no_notification true when that row's email toggle is off", async () => {
    setOrders([richOrder("order_1")])
    setOrderRate("order_1", "shp_1", "rate_1")
    mockBulkFulfillOrders.mockResolvedValue({
      succeeded: ["order_1"],
      failed: [],
    })
    const user = userEvent.setup()

    renderReadyToShipTable()

    await user.click(await screen.findByRole("switch"))
    await user.click(
      await screen.findByRole("button", { name: "orders.readyToShip.fulfill" })
    )
    await user.click(
      await screen.findByRole("button", { name: "actions.confirm" })
    )

    await waitFor(() => {
      expect(mockBulkFulfillOrders).toHaveBeenCalledWith({
        fulfillments: [
          {
            order_id: "order_1",
            location_id: "loc_default",
            shipment_id: "shp_1",
            rate_id: "rate_1",
            no_notification: true,
          },
        ],
      })
    })
  })
})
