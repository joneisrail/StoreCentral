import { buildQueuePage } from "../build-queue-page"

/**
 * Minimal OrderDetailDTO-shaped fixtures. "Needs fulfillment" is
 * determined from real item quantities (any item where quantity >
 * detail.fulfilled_quantity), NOT from order.fulfillment_status --
 * see build-queue-page.ts's own comment for why the status string
 * alone is the wrong signal (it conflates "nothing shipped yet" with
 * "some items still unfulfilled", and a canceled order's fulfillment
 * status says "not_fulfilled" when it should never appear at all).
 * `fulfillment_status` is still carried through for display only.
 */
function baseOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order_1",
    display_id: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    email: "customer@example.com",
    total: 100,
    currency_code: "usd",
    fulfillment_status: "not_fulfilled",
    sales_channel: { id: "sc_1", name: "Storefront" },
    items: [{ id: "item_1", quantity: 1, detail: { fulfilled_quantity: 0 } }],
    ...overrides,
  } as any
}

describe("buildQueuePage", () => {
  test("excludes an order whose items are all fully fulfilled", () => {
    const result = buildQueuePage(
      [
        baseOrder({
          id: "order_fulfilled",
          fulfillment_status: "fulfilled",
          items: [
            { id: "item_1", quantity: 1, detail: { fulfilled_quantity: 1 } },
          ],
        }),
      ],
      { offset: 0, limit: 20 }
    )
    expect(result.orders).toHaveLength(0)
    expect(result.count).toBe(0)
  })

  test("includes an order with a real unfulfilled item, sorted oldest first, regardless of status label", () => {
    const older = baseOrder({
      id: "order_older_not_fulfilled",
      created_at: "2026-01-01T00:00:00.000Z",
      fulfillment_status: "not_fulfilled",
      items: [{ id: "item_1", quantity: 1, detail: { fulfilled_quantity: 0 } }],
    })
    const newer = baseOrder({
      id: "order_newer_partially_fulfilled",
      created_at: "2026-01-02T00:00:00.000Z",
      fulfillment_status: "partially_fulfilled",
      items: [{ id: "item_1", quantity: 2, detail: { fulfilled_quantity: 1 } }],
    })

    const result = buildQueuePage([newer, older], { offset: 0, limit: 20 })

    expect(result.orders.map((o) => o.id)).toEqual([older.id, newer.id])
  })

  test("includes an order that is partially_shipped with one item still unfulfilled (Critical finding #2: a status-string allow-list would wrongly exclude this)", () => {
    // 2 units ordered, only 1 fulfilled+shipped -- core's own
    // getLastFulfillmentStatus would call this "partially_shipped", a
    // status neither "not_fulfilled" nor "partially_fulfilled". It
    // still has a real unfulfilled unit and must appear in the queue.
    const order = baseOrder({
      id: "order_partially_shipped",
      fulfillment_status: "partially_shipped",
      items: [{ id: "item_1", quantity: 2, detail: { fulfilled_quantity: 1 } }],
    })

    const result = buildQueuePage([order], { offset: 0, limit: 20 })

    expect(result.orders.map((o) => o.id)).toEqual([order.id])
    expect(result.orders[0].fulfillment_status).toBe("partially_shipped")
  })

  test("includes an order that is partially_delivered with one item still unfulfilled", () => {
    const order = baseOrder({
      id: "order_partially_delivered",
      fulfillment_status: "partially_delivered",
      items: [{ id: "item_1", quantity: 3, detail: { fulfilled_quantity: 2 } }],
    })

    const result = buildQueuePage([order], { offset: 0, limit: 20 })

    expect(result.orders.map((o) => o.id)).toEqual([order.id])
  })

  test("excludes an order that is fully shipped with no unfulfilled items left", () => {
    const order = baseOrder({
      id: "order_shipped",
      fulfillment_status: "shipped",
      items: [{ id: "item_1", quantity: 2, detail: { fulfilled_quantity: 2 } }],
    })

    const result = buildQueuePage([order], { offset: 0, limit: 20 })

    expect(result.orders).toHaveLength(0)
  })

  test("resolves sales_channel to null without throwing when the order has none", () => {
    const result = buildQueuePage(
      [baseOrder({ id: "order_null_channel", sales_channel: null })],
      { offset: 0, limit: 20 }
    )
    expect(result.orders[0].sales_channel).toBeNull()
  })

  test("counts item_count from items.length", () => {
    const result = buildQueuePage(
      [
        baseOrder({
          id: "order_two_items",
          items: [
            { id: "item_1", quantity: 1, detail: { fulfilled_quantity: 0 } },
            { id: "item_2", quantity: 1, detail: { fulfilled_quantity: 0 } },
          ],
        }),
      ],
      { offset: 0, limit: 20 }
    )
    expect(result.orders[0].item_count).toBe(2)
  })

  test("treats a missing items array as zero items, excluded, not a crash", () => {
    const orderWithNoItemsKey = baseOrder({ id: "order_no_items_key" })
    delete (orderWithNoItemsKey as any).items

    const result = buildQueuePage([orderWithNoItemsKey], {
      offset: 0,
      limit: 20,
    })
    expect(result.orders).toHaveLength(0)
  })

  test("paginates the filtered set, not the raw input (mixing in fully-fulfilled orders that must not count)", () => {
    const fiveUnfulfilled = Array.from({ length: 5 }, (_, i) =>
      baseOrder({
        id: `order_unfulfilled_${i}`,
        created_at: `2026-01-0${i + 1}T00:00:00.000Z`,
      })
    )
    const threeFulfilled = Array.from({ length: 3 }, (_, i) =>
      baseOrder({
        id: `order_fulfilled_${i}`,
        created_at: `2026-02-0${i + 1}T00:00:00.000Z`,
        fulfillment_status: "fulfilled",
        items: [
          { id: "item_1", quantity: 1, detail: { fulfilled_quantity: 1 } },
        ],
      })
    )

    const result = buildQueuePage([...fiveUnfulfilled, ...threeFulfilled], {
      offset: 2,
      limit: 2,
    })
    expect(result.orders).toHaveLength(2)
    expect(result.count).toBe(5)
  })
})
