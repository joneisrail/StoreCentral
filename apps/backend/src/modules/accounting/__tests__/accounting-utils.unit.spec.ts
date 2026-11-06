import { calculatePurchaseTotals } from "../../purchase/utils"
import {
  calculateInvoiceTotals,
  formatInvoiceReference,
  invoiceLockKey,
  invoiceStatusLockKey,
  normalizeInvoiceNumber,
} from "../utils"

describe("accounting utils", () => {
  it("formats invoice references", () => {
    expect(formatInvoiceReference(7)).toBe("INV-0007")
  })

  it("normalizes invoice numbers", () => {
    expect(normalizeInvoiceNumber("  Ab-1 ")).toEqual({
      invoice_number: "Ab-1",
      invoice_number_key: "ab-1",
    })
  })

  it("rejects blank invoice numbers", () => {
    expect(() => normalizeInvoiceNumber("   ")).toThrow(
      "Invoice number is required"
    )
  })

  it("calculates totals like purchases do", () => {
    const items = [{ quantity: 3, unit_cost: 0.1 }]
    const extra = { shipping_cost: 0, tax: 0, other_cost: 0 }
    expect(calculateInvoiceTotals(items, extra)).toEqual({
      subtotal: 0.3,
      total: 0.3,
    })
    expect(calculateInvoiceTotals(items, extra)).toEqual(
      calculatePurchaseTotals(items, extra)
    )
  })

  it("builds lock keys", () => {
    expect(invoiceLockKey("sup_1", "ab-1")).toBe("invoice-number:sup_1:ab-1")
    expect(invoiceStatusLockKey("inv_1")).toBe("invoice:inv_1")
  })
})
