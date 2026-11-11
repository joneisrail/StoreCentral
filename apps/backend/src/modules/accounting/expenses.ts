export const EXPENSE_CATEGORIES = [
  "rent",
  "marketing",
  "software",
  "payroll",
  "shipping_packaging",
  "fees",
  "utilities",
  "other",
] as const

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  rent: "Rent",
  marketing: "Marketing",
  software: "Software",
  payroll: "Payroll",
  shipping_packaging: "Shipping & packaging",
  fees: "Fees",
  utilities: "Utilities",
  other: "Other",
}

export const formatExpenseReference = (displayId: number): string =>
  `EXP-${String(displayId).padStart(4, "0")}`
