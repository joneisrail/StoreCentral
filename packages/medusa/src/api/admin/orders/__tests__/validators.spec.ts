import { AdminGetOrdersParams } from "../validators"

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
