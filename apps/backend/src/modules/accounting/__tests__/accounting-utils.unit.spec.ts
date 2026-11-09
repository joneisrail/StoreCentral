import { calculatePurchaseTotals } from "../../purchase/utils"
import {
  calculateBalance,
  calculateInvoiceTotals,
  calculatePaidTotal,
  formatInvoiceReference,
  formatPaymentReference,
  getPaymentStatus,
  isOverdue,
  isValidPaymentAmount,
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

describe("payment helpers", () => {
  const rec = (amount: number, status = "recorded") => ({ amount, status })

  it("formats payment references", () => {
    expect(formatPaymentReference(7)).toBe("PAY-0007")
  })

  it("validates payment amounts", () => {
    for (const ok of [
      0.01, 12.5, 0.1 + 0.2, 0.3, 131692.98, 131772.17, 131851.36, 9999999.99,
    ]) {
      expect(isValidPaymentAmount(ok)).toBe(true)
    }
    for (const bad of [0, -1, 1.005, 100000.001, 0.004, NaN, Infinity]) {
      expect(isValidPaymentAmount(bad)).toBe(false)
    }
  })

  it("accepts every whole-cent amount in a scan", () => {
    const failures: number[] = []
    for (let c = 1; c <= 2000000; c++) {
      if (!isValidPaymentAmount(c / 100)) failures.push(c)
    }
    let seed = 12345
    const next = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    for (let i = 0; i < 2000; i++) {
      const c = 1 + Math.floor(next() * 100000000)
      if (!isValidPaymentAmount(c / 100)) failures.push(c)
    }
    expect(failures).toEqual([])
  })

  it("sums only non-void payments", () => {
    expect(calculatePaidTotal([rec(0.1), rec(0.2), rec(5, "void")])).toBe(0.3)
  })

  it("calculates balance in cents", () => {
    expect(calculateBalance(10, [rec(3.33), rec(3.33), rec(3.34)])).toBe(0)
  })

  it("derives payment status", () => {
    const g = (invoice_status: string, paid_total: number) =>
      getPaymentStatus({ invoice_status, total: 10, paid_total })
    expect(g("draft", 0)).toBeNull()
    expect(g("void", 0)).toBeNull()
    expect(g("posted", 0)).toBe("unpaid")
    expect(g("posted", 4)).toBe("partially_paid")
    expect(g("posted", 10)).toBe("paid")
    const z = (invoice_status: string, total: number) =>
      getPaymentStatus({ invoice_status, total, paid_total: 0 })
    expect(z("posted", 0)).toBe("paid")
    expect(z("posted", -5)).toBe("paid")
    expect(z("draft", 0)).toBeNull()
    expect(z("void", 0)).toBeNull()
    expect(
      getPaymentStatus({
        invoice_status: "posted",
        total: 10,
        paid_total: calculatePaidTotal([rec(10, "void")]),
      })
    ).toBe("unpaid")
  })

  it("detects overdue invoices", () => {
    const today = new Date("2026-11-10T12:00:00Z")
    const o = (
      invoice_status: string,
      due_date: string | Date | null,
      balance: number
    ) => isOverdue({ invoice_status, due_date, balance }, today)
    expect(o("posted", "2026-11-09T00:00:00Z", 5)).toBe(true)
    expect(o("posted", new Date("2026-11-10T00:00:00Z"), 5)).toBe(false)
    expect(o("posted", null, 5)).toBe(false)
    expect(o("posted", "2026-11-09T00:00:00Z", 0)).toBe(false)
    expect(o("draft", "2026-11-09T00:00:00Z", 5)).toBe(false)
    const edge = (due: string, now: string) =>
      isOverdue(
        { invoice_status: "posted", due_date: due, balance: 5 },
        new Date(now)
      )
    expect(edge("2026-11-09T23:59:59Z", "2026-11-10T00:00:00Z")).toBe(true)
    expect(edge("2026-11-10T00:00:00Z", "2026-11-10T23:59:59Z")).toBe(false)
  })
})
