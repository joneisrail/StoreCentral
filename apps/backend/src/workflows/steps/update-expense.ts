import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ACCOUNTING_MODULE } from "../../modules/accounting"
import AccountingModuleService from "../../modules/accounting/service"
import {
  assertValidAmount,
  assertValidCategory,
  assertValidExpenseDate,
  roundAmount,
  toExpenseDate,
  type CreateExpenseStepInput,
} from "./create-expense"

export type UpdateExpenseStepInput = { id: string } & Partial<CreateExpenseStepInput>

type ExpenseSnapshot = {
  id: string
  expense_date: Date
  category: string
  amount: number
  description: string
  payee: string | null
}

export const updateExpenseStep = createStep(
  "update-expense",
  async (input: UpdateExpenseStepInput, { container }) => {
    const accounting =
      container.resolve<AccountingModuleService>(ACCOUNTING_MODULE)

    // A bad or deleted id throws NOT_FOUND (404).
    const existing = await accounting.retrieveExpense(input.id)

    if (input.amount !== undefined) {
      assertValidAmount(input.amount)
    }
    if (input.category !== undefined) {
      assertValidCategory(input.category)
    }
    if (input.expense_date !== undefined) {
      assertValidExpenseDate(input.expense_date)
    }

    const snapshot: ExpenseSnapshot = {
      id: existing.id,
      expense_date: new Date(existing.expense_date),
      category: existing.category,
      amount: Number(existing.amount),
      description: existing.description,
      payee: existing.payee ?? null,
    }

    const changes: Record<string, unknown> = { id: input.id }
    if (input.expense_date !== undefined) {
      changes.expense_date = toExpenseDate(input.expense_date)
    }
    if (input.category !== undefined) {
      changes.category = input.category
    }
    if (input.amount !== undefined) {
      changes.amount = roundAmount(input.amount)
    }
    if (input.description !== undefined) {
      changes.description = input.description
    }
    if (input.payee !== undefined) {
      changes.payee = input.payee
    }
    await accounting.updateExpenses(changes as never)

    return new StepResponse({ id: input.id }, snapshot)
  },
  async (previous, { container }) => {
    if (!previous) {
      return
    }
    await container
      .resolve<AccountingModuleService>(ACCOUNTING_MODULE)
      .updateExpenses(previous as never)
  }
)
