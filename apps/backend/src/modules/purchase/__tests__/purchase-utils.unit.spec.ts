import { MedusaError } from "@medusajs/framework/utils"
import {
  calculatePurchaseTotals,
  formatPurchaseReference,
  getRemainingQuantity,
  getStatusAfterReceipt,
  validateReceiveQuantities,
} from "../utils"

describe("purchase utils", () => {
  describe("formatPurchaseReference", () => {
    it("zero-pads to 4 digits", () => {
      expect(formatPurchaseReference(1)).toBe("PO-0001")
    })

    it("does not truncate longer numbers", () => {
      expect(formatPurchaseReference(12345)).toBe("PO-12345")
    })
  })

  describe("calculatePurchaseTotals", () => {
    it("sums items and extra costs", () => {
      expect(
        calculatePurchaseTotals(
          [
            { quantity: 2, unit_cost: 12.5 },
            { quantity: 1, unit_cost: 0.1 },
          ],
          { shipping_cost: 5, tax: 1.25, other_cost: 0 }
        )
      ).toEqual({ subtotal: 25.1, total: 31.35 })
    })

    it("rounds floating point sums", () => {
      expect(
        calculatePurchaseTotals(
          [
            { quantity: 1, unit_cost: 0.1 },
            { quantity: 1, unit_cost: 0.2 },
          ],
          { shipping_cost: 0, tax: 0, other_cost: 0 }
        )
      ).toEqual({ subtotal: 0.3, total: 0.3 })
    })
  })

  describe("getRemainingQuantity", () => {
    it("returns quantity minus received", () => {
      expect(getRemainingQuantity({ quantity: 10, quantity_received: 4 })).toBe(6)
    })
  })

  describe("validateReceiveQuantities", () => {
    const items = [
      { id: "i1", title: "Widget", quantity: 10, quantity_received: 4 },
    ]

    it("accepts a valid request", () => {
      expect(() =>
        validateReceiveQuantities(items, [{ purchase_item_id: "i1", quantity: 6 }])
      ).not.toThrow()
    })

    it("throws when quantity exceeds remaining", () => {
      expect.assertions(3)
      try {
        validateReceiveQuantities(items, [{ purchase_item_id: "i1", quantity: 7 }])
      } catch (e: any) {
        expect(e).toBeInstanceOf(MedusaError)
        expect(e.message).toContain("Widget")
        expect(e.message).toContain("6")
      }
    })

    it("throws for quantity 0", () => {
      expect(() =>
        validateReceiveQuantities(items, [{ purchase_item_id: "i1", quantity: 0 }])
      ).toThrow(MedusaError)
    })

    it("throws for a non-integer quantity", () => {
      expect(() =>
        validateReceiveQuantities(items, [{ purchase_item_id: "i1", quantity: 1.5 }])
      ).toThrow(MedusaError)
    })

    it("throws for an unknown purchase item", () => {
      expect(() =>
        validateReceiveQuantities(items, [{ purchase_item_id: "nope", quantity: 1 }])
      ).toThrow(MedusaError)
    })

    it("throws for an empty request", () => {
      expect(() => validateReceiveQuantities(items, [])).toThrow(MedusaError)
    })
  })

  describe("getStatusAfterReceipt", () => {
    it("is partially_received while any item has remaining", () => {
      expect(
        getStatusAfterReceipt([
          { quantity: 5, quantity_received: 5 },
          { quantity: 5, quantity_received: 2 },
        ])
      ).toBe("partially_received")
    })

    it("is received when all items are full", () => {
      expect(
        getStatusAfterReceipt([
          { quantity: 5, quantity_received: 5 },
          { quantity: 3, quantity_received: 3 },
        ])
      ).toBe("received")
    })
  })
})
