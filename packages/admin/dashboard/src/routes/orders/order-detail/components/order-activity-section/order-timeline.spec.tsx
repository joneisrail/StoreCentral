// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { TooltipProvider } from "@medusajs/ui"
import { afterEach, describe, expect, it, vi } from "vitest"

const { mockEvents, mockOrder } = vi.hoisted(() => ({
  mockEvents: vi.fn(),
  mockOrder: vi.fn(),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      return opts ? `${key}${JSON.stringify(opts)}` : key
    },
  }),
}))
vi.mock("../../../../../hooks/api/order-events", () => ({
  useOrderEvents: () => mockEvents(),
}))
vi.mock("../../../../../hooks/api", () => ({
  useCancelOrderTransfer: () => ({ mutateAsync: vi.fn() }),
  useCustomer: () => ({}),
  useOrder: () => mockOrder(),
  useOrderChanges: () => ({ order_changes: [] }),
  useOrderLineItems: () => ({ order_items: [] }),
}))
vi.mock("../../../../../hooks/api/claims", () => ({
  useCancelClaim: () => ({ mutateAsync: vi.fn() }),
  useClaims: () => ({ claims: [] }),
}))
vi.mock("../../../../../hooks/api/exchanges", () => ({
  useCancelExchange: () => ({ mutateAsync: vi.fn() }),
  useExchanges: () => ({ exchanges: [] }),
}))
vi.mock("../../../../../hooks/api/returns", () => ({
  useCancelReturn: () => ({ mutateAsync: vi.fn() }),
  useReturns: () => ({ returns: [] }),
}))
vi.mock("../../../../../hooks/use-date", () => ({
  useDate: () => ({
    getFullDate: () => "full",
    getRelativeDate: (d: string) => `rel:${d}`,
  }),
}))
vi.mock("../../../../../components/common/user-link", () => ({
  By: ({ id }: { id: string }) => <span>by-link:{id}</span>,
}))
vi.mock("../../../../../components/common/thumbnail", () => ({
  Thumbnail: () => null,
}))

import { OrderTimeline } from "./order-timeline"

const order = {
  id: "order_1",
  version: 1,
  items: [],
  fulfillments: [],
  payment_collections: [],
  canceled_at: null,
} as never

const ev = (over: Record<string, unknown>) => ({
  id: "e",
  type: "order.held",
  actor: "system",
  old_value: null,
  new_value: null,
  created_at: "2026-01-02T00:00:00.000Z",
  ...over,
})

const setup = (events: unknown[], isError = false, o: unknown = order) => {
  mockOrder.mockReturnValue({
    order: {
      created_at: "2026-01-01T00:00:00.000Z",
      total: 10,
      currency_code: "usd",
    },
  })
  mockEvents.mockReturnValue({ events, isLoading: false, isError })
  return render(
    <TooltipProvider>
      <OrderTimeline order={o as never} />
    </TooltipProvider>
  )
}

afterEach(() => {
  cleanup()
  mockEvents.mockReset()
  mockOrder.mockReset()
})

describe("OrderTimeline change history", () => {
  it("merges events with existing items by time", () => {
    const { container } = setup([
      ev({
        id: "a",
        type: "order.held",
        created_at: "2026-01-03T00:00:00.000Z",
      }),
      ev({
        id: "b",
        type: "order.released",
        created_at: "2026-01-02T00:00:00.000Z",
      }),
    ])
    const text = container.textContent ?? ""
    const iShipped = text.indexOf("orders.activity.events.order.held")
    const iDelivered = text.indexOf("orders.activity.events.order.released")
    const iPlaced = text.indexOf("orders.activity.events.placed.title")
    expect(iShipped).toBeGreaterThan(-1)
    expect(iShipped).toBeLessThan(iDelivered)
    expect(iDelivered).toBeLessThan(iPlaced)
  })

  it("renders each type's summary", () => {
    setup([
      ev({ id: "1", type: "order.held", new_value: { reason: "fraud check" } }),
      ev({
        id: "2",
        type: "order.released",
        old_value: { reason: "old reason" },
      }),
    ])
    expect(screen.getByText(/fraud check/)).toBeTruthy()
    expect(screen.getByText(/old reason/)).toBeTruthy()
  })

  it("summarises label void count, shipped tracking and canceled", () => {
    setup([
      ev({
        id: "1",
        type: "order.label_voided",
        new_value: { fulfillment_ids: ["a", "b"] },
      }),
      ev({
        id: "2",
        type: "order.marked_shipped",
        new_value: { carrier: "UPS", tracking_number: "1Z999" },
        created_at: "2026-01-01T12:00:00.000Z",
      }),
    ])
    expect(screen.getByText(/"count":2/)).toBeTruthy()
    expect(screen.getByText(/UPS.*·.*1Z999/)).toBeTruthy()
  })

  it("does not duplicate rows core already shows", () => {
    const coreOrder = {
      id: "order_1",
      version: 1,
      items: [],
      payment_collections: [],
      canceled_at: "2026-01-05T00:00:00.000Z",
      fulfillments: [
        {
          id: "ful_1",
          items: [],
          created_at: "2026-01-02T00:00:00.000Z",
          shipped_at: "2026-01-03T00:00:00.000Z",
          delivered_at: "2026-01-04T00:00:00.000Z",
        },
      ],
    } as never
    setup(
      [
        ev({ id: "1", type: "order.canceled", actor: "system" }),
        ev({ id: "2", type: "order.shipped", actor: "system" }),
        ev({ id: "3", type: "order.delivered", actor: "system" }),
      ],
      false,
      coreOrder
    )
    fireEvent.click(screen.getByText(/showMoreActivities/))
    expect(
      screen.getAllByText("orders.activity.events.canceled.title")
    ).toHaveLength(1)
    expect(
      screen.getAllByText("orders.activity.events.fulfillment.shipped")
    ).toHaveLength(1)
    expect(
      screen.getAllByText("orders.activity.events.fulfillment.delivered")
    ).toHaveLength(1)
    expect(
      screen.queryByText("orders.activity.events.order.canceled")
    ).toBeNull()
    expect(
      screen.queryByText("orders.activity.events.order.shipped")
    ).toBeNull()
    expect(
      screen.queryByText("orders.activity.events.order.delivered")
    ).toBeNull()
  })

  it("keeps collapsing and shows the note on error with many items", () => {
    setup(
      [
        ev({
          id: "1",
          type: "order.held",
          created_at: "2026-01-02T00:00:00.000Z",
        }),
        ev({
          id: "2",
          type: "order.released",
          created_at: "2026-01-03T00:00:00.000Z",
        }),
        ev({
          id: "3",
          type: "order.label_voided",
          created_at: "2026-01-04T00:00:00.000Z",
        }),
      ],
      true
    )
    expect(screen.getByText(/showMoreActivities/)).toBeTruthy()
    expect(screen.getByText("orders.activity.eventsUnavailable")).toBeTruthy()
  })

  it("renders existing items unchanged while events load", () => {
    mockOrder.mockReturnValue({
      order: {
        created_at: "2026-01-01T00:00:00.000Z",
        total: 10,
        currency_code: "usd",
      },
    })
    mockEvents.mockReturnValue({ events: [], isLoading: true, isError: false })
    render(
      <TooltipProvider>
        <OrderTimeline order={order} />
      </TooltipProvider>
    )
    expect(screen.getByText("orders.activity.events.placed.title")).toBeTruthy()
    expect(screen.queryByText("orders.activity.eventsUnavailable")).toBeNull()
  })

  it("shows the actor name, System and Unknown", () => {
    setup([
      ev({ id: "1", actor: { id: "user_1", name: "Ada Lovelace" } }),
      ev({ id: "2", actor: "system" }),
    ])
    expect(screen.getByText("Ada Lovelace")).toBeTruthy()
    expect(
      screen.getByText("orders.activity.events.order.actor.system")
    ).toBeTruthy()
  })

  it("shows Unknown for an unknown actor", () => {
    setup([ev({ id: "3", actor: { id: "unknown", name: null } })])
    expect(
      screen.getByText("orders.activity.events.order.actor.unknown")
    ).toBeTruthy()
  })

  it("uses the user link when only the id is known", () => {
    setup([ev({ actor: { id: "user_9", name: null } })])
    expect(screen.getByText("by-link:user_9")).toBeTruthy()
  })

  it("renders reasons as escaped text", () => {
    const { container } = setup([
      ev({
        type: "order.held",
        new_value: { reason: "<img src=x onerror=alert(1)>" },
      }),
    ])
    expect(container.querySelector("img")).toBeNull()
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>")
  })

  it("events error keeps the timeline and shows the note", () => {
    setup([], true)
    expect(screen.getByText("orders.activity.events.placed.title")).toBeTruthy()
    expect(screen.getByText("orders.activity.eventsUnavailable")).toBeTruthy()
  })

  it("no events renders unchanged", () => {
    setup([])
    expect(screen.getByText("orders.activity.events.placed.title")).toBeTruthy()
    expect(screen.queryByText("orders.activity.eventsUnavailable")).toBeNull()
  })
})
