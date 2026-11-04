import { findQualifyingOrderId } from "../check-verified-purchase"

describe("findQualifyingOrderId", () => {
  it("returns the order id when an order contains the product", () => {
    const result = findQualifyingOrderId(
      [{ id: "order_1", items: [{ product_id: "prod_1" }] }],
      "prod_1"
    )
    expect(result).toBe("order_1")
  })

  it("returns null when no order contains the product", () => {
    const result = findQualifyingOrderId(
      [{ id: "order_1", items: [{ product_id: "prod_other" }] }],
      "prod_1"
    )
    expect(result).toBeNull()
  })

  it("returns null for an empty orders list", () => {
    expect(findQualifyingOrderId([], "prod_1")).toBeNull()
  })

  it("ignores an item with a null product_id", () => {
    const result = findQualifyingOrderId(
      [{ id: "order_1", items: [{ product_id: null }] }],
      "prod_1"
    )
    expect(result).toBeNull()
  })

  it("returns the first qualifying order when more than one matches", () => {
    const result = findQualifyingOrderId(
      [
        { id: "order_1", items: [{ product_id: "prod_1" }] },
        { id: "order_2", items: [{ product_id: "prod_1" }] },
      ],
      "prod_1"
    )
    expect(result).toBe("order_1")
  })
})
