import { describe, expect, it } from "vitest"
import { getViewQuery, ORDER_VIEW_ORDER, SHIPPED_QUERY } from "../order-views"

const ctx = { heldIds: ["o1", "o2"], holdTagId: "tag_1" }
const none = { heldIds: [], holdTagId: "tag_1" }

describe("getViewQuery", () => {
  it("returns the documented params per view", () => {
    expect(ORDER_VIEW_ORDER).toEqual([
      "all",
      "ready-to-ship",
      "shipped",
      "awaiting-payment",
      "on-hold",
      "cancelled",
    ])
    expect(getViewQuery("all", ctx)).toEqual({})
    expect(getViewQuery("ready-to-ship", ctx)).toEqual({
      fulfillment_status: ["not_fulfilled", "partially_fulfilled", "canceled"],
      payment_status: ["captured", "partially_captured"],
      status: { $nin: ["canceled"] },
      id: { $nin: ["o1", "o2"] },
    })
    expect(getViewQuery("shipped", ctx)).toEqual(SHIPPED_QUERY)
    expect(SHIPPED_QUERY.fulfillment_status).toEqual([
      "fulfilled",
      "shipped",
      "partially_shipped",
      "partially_delivered",
      "delivered",
    ])
    expect(getViewQuery("awaiting-payment", ctx)).toEqual({
      payment_status: ["not_paid", "awaiting"],
      status: { $nin: ["canceled"] },
      id: { $nin: ["o1", "o2"] },
    })
    expect(getViewQuery("on-hold", ctx)).toEqual({
      tag_id: "tag_1",
      status: { $nin: ["canceled"] },
    })
    expect(getViewQuery("cancelled", ctx)).toEqual({ status: "canceled" })
  })

  it("ready-to-ship and awaiting-payment omit id.$nin when nothing is held", () => {
    expect(getViewQuery("ready-to-ship", none)).not.toHaveProperty("id")
    expect(getViewQuery("awaiting-payment", none)).not.toHaveProperty("id")
  })

  it("on-hold with no tag id returns an impossible filter (no rows)", () => {
    const q = getViewQuery("on-hold", { heldIds: [], holdTagId: null })
    expect(q).not.toHaveProperty("tag_id")
    expect(q.id).toBe("__no_hold_tag__")
  })
})
