import { MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ACCOUNTING_MODULE } from "../../modules/accounting"
import AccountingModuleService from "../../modules/accounting/service"
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
} from "../../modules/accounting/expenses"
import { isValidPaymentAmount } from "../../modules/accounting/utils"

export type CreateExpenseStepInput = {
  expense_date: string
  category: ExpenseCategory
  amount: number
  description: string
  payee?: string | null
}

const invalid = (message: string) =>
  new MedusaError(MedusaError.Types.INVALID_DATA, message)

export const assertValidAmount = (amount: number): void => {
  if (!isValidPaymentAmount(amount)) {
    throw invalid(
      "Amount must be greater than zero with at most 2 decimal places"
    )
  }
}

export const assertValidCategory = (category: string): void => {
  if (!(EXPENSE_CATEGORIES as readonly string[]).includes(category)) {
    throw invalid(
      `Category must be one of: ${EXPENSE_CATEGORIES.join(", ")}`
    )
  }
}

// A calendar date, not more than one day after today (UTC) so a store in an
// earlier-ahead time zone can still record "today".
export const assertValidExpenseDate = (date: string, now = new Date()): void => {
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw invalid("Expense date must be a valid date (YYYY-MM-DD)")
  }
  const limit = new Date(now.getTime() + 86400000).toISOString().slice(0, 10)
  if (date > limit) {
    throw invalid("Expense date cannot be in the future")
  }
}

export const toExpenseDate = (date: string): Date =>
  new Date(`${date}T00:00:00.000Z`)

export const roundAmount = (amount: number): number =>
  Math.round(amount * 100) / 100

export const createExpenseStep = createStep(
  "create-expense",
  async (input: CreateExpenseStepInput, { container }) => {
    assertValidAmount(input.amount)
    assertValidCategory(input.category)
    assertValidExpenseDate(input.expense_date)

    const accounting =
      container.resolve<AccountingModuleService>(ACCOUNTING_MODULE)
    const created = await accounting.createExpenses({
      expense_date: toExpenseDate(input.expense_date),
      category: input.category,
      amount: roundAmount(input.amount),
      description: input.description,
      payee: input.payee ?? null,
    } as never)

    return new StepResponse({ id: created.id }, created.id)
  },
  async (expenseId, { container }) => {
    if (!expenseId) {
      return
    }
    await container
      .resolve<AccountingModuleService>(ACCOUNTING_MODULE)
      .deleteExpenses(expenseId)
  }
)
