import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  formatExpenseReference,
} from "../expenses"

describe("expense helpers", () => {
  it("formats the expense reference", () => {
    expect(formatExpenseReference(1)).toBe("EXP-0001")
    expect(formatExpenseReference(12345)).toBe("EXP-12345")
  })

  it("keeps the category order", () => {
    expect([...EXPENSE_CATEGORIES]).toEqual([
      "rent",
      "marketing",
      "software",
      "payroll",
      "shipping_packaging",
      "fees",
      "utilities",
      "other",
    ])
  })

  it("labels every category", () => {
    expect(EXPENSE_CATEGORY_LABELS).toEqual({
      rent: "Rent",
      marketing: "Marketing",
      software: "Software",
      payroll: "Payroll",
      shipping_packaging: "Shipping & packaging",
      fees: "Fees",
      utilities: "Utilities",
      other: "Other",
    })
  })
})
