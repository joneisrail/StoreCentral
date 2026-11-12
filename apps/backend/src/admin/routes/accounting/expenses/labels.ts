import type { ExpenseCategory } from "../types"

// Local copy: the admin cannot import from src/modules.
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

export const EXPENSE_CATEGORIES = Object.keys(
  EXPENSE_CATEGORY_LABELS
) as ExpenseCategory[]

export function expenseCategoryLabel(category: string) {
  return (
    (EXPENSE_CATEGORY_LABELS as Record<string, string>)[category] ?? category
  )
}
