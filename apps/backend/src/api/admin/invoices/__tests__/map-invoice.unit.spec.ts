import { mapInvoice } from "../map-invoice"
import type { InvoiceRow } from "../map-invoice"

const TODAY = new Date("2026-11-10T15:00:00.000Z")

const row = (over: Partial<InvoiceRow> = {}): InvoiceRow => ({
  id: "inv_1",
  display_id: 1,
  status: "posted",
  supplier_id: "sup_1",
  purchase_id: "pur_1",
  invoice_number: "A-1",
  invoice_date: "2026-11-01T00:00:00.000Z",
  due_date: "2026-11-09T00:00:00.000Z",
  shipping_cost: 0,
  tax: 0,
  other_cost: 0,
  notes: null,
  posted_at: null,
  voided_at: null,
  created_at: "2026-11-01T00:00:00.000Z",
  items: [
    {
      id: "ii_1",
      purchase_item_id: null,
      variant_id: "var_1",
      supplier_sku: "S",
      description: "d",
      quantity: 1,
      unit_cost: 10,
    },
  ],
  ...over,
})

const extras = { supplier: null, purchase: null }

describe("mapInvoice payment fields", () => {
  it("is unpaid and overdue with no payments past the due date", () => {
    const out = mapInvoice(row(), extras, [], TODAY)
    expect(out).toMatchObject({
      paid_total: 0,
      balance: 10,
      payment_status: "unpaid",
      overdue: true,
    })
  })

  it("is partially paid with a part payment", () => {
    const out = mapInvoice(
      row(),
      extras,
      [{ amount: "4.10", status: "recorded" }],
      TODAY
    )
    expect(out).toMatchObject({
      paid_total: 4.1,
      balance: 5.9,
      payment_status: "partially_paid",
      overdue: true,
    })
  })

  it("is paid and not overdue once the balance is zero", () => {
    const out = mapInvoice(
      row(),
      extras,
      [
        { amount: 4.1, status: "recorded" },
        { amount: 5.9, status: "recorded" },
      ],
      TODAY
    )
    expect(out).toMatchObject({
      paid_total: 10,
      balance: 0,
      payment_status: "paid",
      overdue: false,
    })
  })

  it("ignores void payments", () => {
    const out = mapInvoice(
      row(),
      extras,
      [{ amount: 10, status: "void" }],
      TODAY
    )
    expect(out).toMatchObject({
      paid_total: 0,
      balance: 10,
      payment_status: "unpaid",
    })
  })

  it("is not overdue on the due date itself", () => {
    const out = mapInvoice(
      row({ due_date: "2026-11-10T00:00:00.000Z" }),
      extras,
      [],
      TODAY
    )
    expect(out.overdue).toBe(false)
  })

  it("has a null payment status and no overdue for a draft or void invoice", () => {
    for (const status of ["draft", "void"]) {
      const out = mapInvoice(row({ status }), extras, [], TODAY)
      expect(out.payment_status).toBeNull()
      expect(out.overdue).toBe(false)
      expect(out.paid_total).toBe(0)
      expect(out.balance).toBe(10)
    }
  })
})
