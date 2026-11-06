import {
  buildCreateBody,
  lineWarnings,
  parseCost,
  parseQuantity,
  prefillLines,
} from "../line-entry"
import type { InvoiceFormState, Line } from "../line-entry"

const purchaseItems = [
  {
    id: "pi_1",
    variant_id: "var_1",
    sku: "S1",
    title: "Oud Royal",
    quantity: 10,
    quantity_received: 4,
    remaining: 6,
    unit_cost: 12.5,
  },
  {
    id: "pi_2",
    variant_id: "var_2",
    sku: "S2",
    title: "Amber Night",
    quantity: 3,
    quantity_received: 3,
    remaining: 0,
    unit_cost: 8,
  },
]

function invoice(status: string, items: Array<[string | null, number]>) {
  return {
    id: "inv",
    status,
    items: items.map(([purchase_item_id, quantity]) => ({
      purchase_item_id,
      quantity,
    })),
  } as never
}

function line(overrides: Partial<Line> = {}): Line {
  return {
    key: "k1",
    purchase_item_id: "pi_1",
    variant_id: "var_1",
    supplier_sku: "",
    remember_code: false,
    label: "Oud Royal",
    quantity: "2",
    unit_cost: "12.5",
    ...overrides,
  }
}

describe("prefillLines", () => {
  it("uses the ordered quantity and cost when nothing is invoiced", () => {
    const lines = prefillLines(purchaseItems, [])
    expect(lines.map((l) => [l.purchase_item_id, l.quantity, l.unit_cost])).toEqual(
      [
        ["pi_1", "10", "12.5"],
        ["pi_2", "3", "8"],
      ]
    )
  })

  it("subtracts quantities already on non-void invoices and omits zero lines", () => {
    const lines = prefillLines(purchaseItems, [
      invoice("posted", [["pi_1", 4], ["pi_2", 3]]),
      invoice("draft", [["pi_1", 2]]),
      invoice("void", [["pi_1", 9]]),
    ])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ purchase_item_id: "pi_1", quantity: "4" })
  })

  it("never goes below zero", () => {
    const lines = prefillLines(purchaseItems, [invoice("posted", [["pi_2", 50]])])
    expect(lines.map((l) => l.purchase_item_id)).toEqual(["pi_1"])
  })
})

describe("strict parsing", () => {
  it.each(["", " ", "abc", "-1", "1.5", "0", "1e2"])(
    "rejects quantity %p",
    (value) => {
      expect(parseQuantity(value)).toBeNull()
    }
  )
  it("accepts whole quantities", () => {
    expect(parseQuantity("3")).toBe(3)
  })
  it.each(["", "abc", "-1", "1e2", "."])("rejects cost %p", (value) => {
    expect(parseCost(value)).toBeNull()
  })
  it("accepts costs of zero or more", () => {
    expect([parseCost("0"), parseCost("12.5"), parseCost(".5")]).toEqual([
      0, 12.5, 0.5,
    ])
  })
})

describe("buildCreateBody", () => {
  const base: InvoiceFormState = {
    purchase_id: "pur_1",
    invoice_number: " SUP-9 ",
    invoice_date: "2026-10-05",
    due_date: "",
    shipping_cost: "",
    tax: "1.5",
    other_cost: "",
    notes: "  ",
    lines: [line()],
  }

  it("builds a plain-dollar body and omits empty optionals", () => {
    expect(buildCreateBody(base)).toEqual({
      purchase_id: "pur_1",
      invoice_number: "SUP-9",
      invoice_date: "2026-10-05",
      shipping_cost: 0,
      tax: 1.5,
      other_cost: 0,
      items: [
        {
          purchase_item_id: "pi_1",
          variant_id: "var_1",
          quantity: 2,
          unit_cost: 12.5,
        },
      ],
    })
  })

  it("carries due date, notes, supplier code and remember_code", () => {
    const body = buildCreateBody({
      ...base,
      due_date: "2026-11-01",
      notes: " hi ",
      lines: [
        line({
          purchase_item_id: null,
          supplier_sku: "ABC-1",
          remember_code: true,
        }),
      ],
    })
    expect(body.due_date).toBe("2026-11-01")
    expect(body.notes).toBe("hi")
    expect(body.items[0]).toEqual({
      variant_id: "var_1",
      supplier_sku: "ABC-1",
      remember_code: true,
      quantity: 2,
      unit_cost: 12.5,
    })
  })

  it("throws on an unreadable quantity instead of treating it as cleared", () => {
    expect(() =>
      buildCreateBody({ ...base, lines: [line({ quantity: "abc" })] })
    ).toThrow()
  })
})

describe("lineWarnings", () => {
  it("flags price difference, over ordered and over received", () => {
    const lines = [line({ quantity: "5", unit_cost: "13" })]
    const w = lineWarnings(lines, purchaseItems, [invoice("posted", [["pi_1", 6]])])
    expect(w.get("k1")).toEqual({
      price_difference: true,
      over_ordered: true,
      over_received: true,
      not_on_purchase: false,
    })
  })

  it("is quiet when quantity and price match", () => {
    const lines = [line({ quantity: "3" })]
    expect(lineWarnings(lines, purchaseItems, []).get("k1")).toEqual({
      price_difference: false,
      over_ordered: false,
      over_received: false,
      not_on_purchase: false,
    })
  })

  it("marks lines without a purchase item as not on purchase", () => {
    const w = lineWarnings([line({ purchase_item_id: null })], purchaseItems, [])
    expect(w.get("k1")?.not_on_purchase).toBe(true)
  })
})
