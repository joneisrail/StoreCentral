import { AdminBulkFulfillOrders, AdminGetOrdersParams } from "../validators"

describe("AdminGetOrdersParams", () => {
  it("accepts an id $nin operator filter and passes it through", () => {
    const parsed = AdminGetOrdersParams.parse({
      id: { $nin: ["a", "b"] },
      status: { $nin: ["canceled"] },
      limit: 1,
      fields: "id",
    })

    expect(parsed.id).toEqual({ $nin: ["a", "b"] })
    expect(parsed.status).toEqual({ $nin: ["canceled"] })
  })
})

describe("AdminBulkFulfillOrders", () => {
  const entry = { order_id: "o1", shipment_id: "shp", rate_id: "rate" }

  it("accepts an optional per-order no_notification flag", () => {
    const parsed = AdminBulkFulfillOrders.parse({
      fulfillments: [{ ...entry, no_notification: true }, entry],
    })

    expect(parsed.fulfillments[0].no_notification).toBe(true)
    expect(parsed.fulfillments[1].no_notification).toBeUndefined()
  })

  it("rejects a non-boolean no_notification", () => {
    expect(() =>
      AdminBulkFulfillOrders.parse({
        fulfillments: [{ ...entry, no_notification: "yes" }],
      })
    ).toThrow()
  })
})
