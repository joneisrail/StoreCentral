import {
  formatExpenseReference,
  type ExpenseCategory,
} from "../../../modules/accounting/expenses"

type DateValue = string | Date

export type ExpenseRow = {
  id: string
  display_id: number
  expense_date: DateValue
  category: string
  amount: number | string
  description: string
  payee: string | null
  currency_code: string
  created_at: DateValue
}

export type AdminExpense = {
  id: string
  reference: string
  expense_date: string
  category: ExpenseCategory
  amount: number
  description: string
  payee: string | null
  currency_code: string
  created_at: DateValue
}

// The expense date is a calendar date stored as 00:00 UTC.
const toDateOnly = (value: DateValue): string =>
  new Date(value).toISOString().slice(0, 10)

export const mapExpense = (row: ExpenseRow): AdminExpense => ({
  id: row.id,
  reference: formatExpenseReference(row.display_id),
  expense_date: toDateOnly(row.expense_date),
  category: row.category as ExpenseCategory,
  amount: Number(row.amount),
  description: row.description,
  payee: row.payee ?? null,
  currency_code: row.currency_code,
  created_at: row.created_at,
})
