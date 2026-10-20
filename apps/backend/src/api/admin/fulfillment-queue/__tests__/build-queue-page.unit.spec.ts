import { buildQueuePage } from "../build-queue-page"

/**
 * Minimal OrderDetailDTO-shaped fixtures -- buildQueuePage reads
 * fulfillment_status directly (already computed by getOrdersListWorkflow
 * before this function ever sees the order; see build-queue-page.ts's
 * own comment for why it is not recomputed here) plus id, display_id,
 * created_at, email, total, currency_code, sales_channel, items.length.
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
    items: [{ id: "item_1" }],
    ...overrides,
  } as any
}

describe("buildQueuePage", () => {
  test("excludes a fulfilled order", () => {
    const result = buildQueuePage(
      [baseOrder({ id: "order_fulfilled", fulfillment_status: "fulfilled" })],
      { offset: 0, limit: 20 }
    )
    expect(result.orders).toHaveLength(0)
    expect(result.count).toBe(0)
  })

  test("excludes a canceled order", () => {
    const result = buildQueuePage(
      [baseOrder({ id: "order_canceled", fulfillment_status: "canceled" })],
      { offset: 0, limit: 20 }
    )
    expect(result.orders).toHaveLength(0)
    expect(result.count).toBe(0)
  })

  test("includes a not_fulfilled order and a partially_fulfilled order, sorted oldest first", () => {
    const older = baseOrder({
      id: "order_older_not_fulfilled",
      created_at: "2026-01-01T00:00:00.000Z",
      fulfillment_status: "not_fulfilled",
    })
    const newer = baseOrder({
      id: "order_newer_partially_fulfilled",
      created_at: "2026-01-02T00:00:00.000Z",
      fulfillment_status: "partially_fulfilled",
    })

    const result = buildQueuePage([newer, older], { offset: 0, limit: 20 })

    expect(result.orders.map((o) => o.id)).toEqual([older.id, newer.id])
    expect(result.orders[0].fulfillment_status).toBe("not_fulfilled")
    expect(result.orders[1].fulfillment_status).toBe("partially_fulfilled")
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
          items: [{ id: "item_1" }, { id: "item_2" }],
        }),
      ],
      { offset: 0, limit: 20 }
    )
    expect(result.orders[0].item_count).toBe(2)
  })

  test("treats a missing items array as zero items, not a crash", () => {
    const orderWithNoItemsKey = baseOrder({ id: "order_no_items_key" })
    delete (orderWithNoItemsKey as any).items

    const result = buildQueuePage([orderWithNoItemsKey], {
      offset: 0,
      limit: 20,
    })
    expect(result.orders[0].item_count).toBe(0)
  })

  test("paginates the filtered set, not the raw input", () => {
    const fiveUnfulfilled = Array.from({ length: 5 }, (_, i) =>
      baseOrder({
        id: `order_unfulfilled_${i}`,
        created_at: `2026-01-0${i + 1}T00:00:00.000Z`,
      })
    )
    const result = buildQueuePage(fiveUnfulfilled, { offset: 2, limit: 2 })
    expect(result.orders).toHaveLength(2)
    expect(result.count).toBe(5)
  })
})
