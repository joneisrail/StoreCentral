import { summarizeBalances } from "../summarize-balances"

const today = new Date("2026-11-10T12:00:00Z")

type Input = Parameters<typeof summarizeBalances>[0][number]

const invoice = (over: Partial<Input> = {}): Input => ({
  supplier_id: "sup_a",
  status: "posted",
  total: 100,
  due_date: null,
  payments: [],
  ...over,
})

describe("summarizeBalances", () => {
  it("returns nothing for no invoices", () => {
    expect(summarizeBalances([], today)).toEqual([])
  })

  it("aggregates two suppliers", () => {
    const result = summarizeBalances(
      [
        invoice({ total: 100, payments: [{ amount: 40, status: "recorded" }] }),
        invoice({ total: 50 }),
        invoice({ supplier_id: "sup_b", total: 30.5 }),
      ],
      today
    )
    expect(result).toEqual([
      {
        supplier_id: "sup_a",
        invoiced_total: 150,
        paid_total: 40,
        balance_owed: 110,
        overdue_total: 0,
        open_invoices: 2,
      },
      {
        supplier_id: "sup_b",
        invoiced_total: 30.5,
        paid_total: 0,
        balance_owed: 30.5,
        overdue_total: 0,
        open_invoices: 1,
      },
    ])
  })

  it("ignores draft and void invoices", () => {
    const result = summarizeBalances(
      [
        invoice({ status: "draft", total: 999 }),
        invoice({ status: "void", total: 888 }),
        invoice({ total: 10 }),
      ],
      today
    )
    expect(result).toHaveLength(1)
    expect(result[0].invoiced_total).toBe(10)
  })

  it("omits a supplier with only draft or void invoices", () => {
    expect(
      summarizeBalances([invoice({ status: "draft" })], today)
    ).toEqual([])
  })

  it("ignores voided payments", () => {
    const [row] = summarizeBalances(
      [
        invoice({
          total: 100,
          payments: [
            { amount: 30, status: "recorded" },
            { amount: 70, status: "void" },
          ],
        }),
      ],
      today
    )
    expect(row.paid_total).toBe(30)
    expect(row.balance_owed).toBe(70)
    expect(row.open_invoices).toBe(1)
  })

  it("sums the balance of overdue invoices using the given today", () => {
    const invoices = [
      invoice({ total: 100, due_date: "2026-11-09" }),
      invoice({
        total: 60,
        due_date: new Date("2026-11-01T00:00:00Z"),
        payments: [{ amount: 10, status: "recorded" }],
      }),
      invoice({ total: 40, due_date: "2026-11-10" }),
      invoice({ total: 25, due_date: "2026-12-01" }),
      invoice({ total: 5, due_date: "2026-10-01", payments: [{ amount: 5, status: "recorded" }] }),
      invoice({ total: 7, due_date: null }),
    ]
    const [row] = summarizeBalances(invoices, today)
    expect(row.overdue_total).toBe(150)
    expect(row.balance_owed).toBe(222)
    expect(row.open_invoices).toBe(5)
    const [later] = summarizeBalances(invoices, new Date("2026-11-11T00:00:00Z"))
    expect(later.overdue_total).toBe(190)
  })

  it("is cent exact", () => {
    const [row] = summarizeBalances(
      [
        invoice({
          total: 0.3,
          payments: [
            { amount: 0.1, status: "recorded" },
            { amount: 0.2, status: "recorded" },
          ],
        }),
      ],
      today
    )
    expect(row.paid_total).toBe(0.3)
    expect(row.balance_owed).toBe(0)
    expect(row.open_invoices).toBe(0)
  })

  it("sorts by balance owed descending then supplier id", () => {
    const result = summarizeBalances(
      [
        invoice({ supplier_id: "sup_c", total: 10 }),
        invoice({ supplier_id: "sup_b", total: 50 }),
        invoice({ supplier_id: "sup_a", total: 50 }),
        invoice({ supplier_id: "sup_d", total: 90 }),
      ],
      today
    )
    expect(result.map((r) => r.supplier_id)).toEqual([
      "sup_d",
      "sup_a",
      "sup_b",
      "sup_c",
    ])
  })
})
