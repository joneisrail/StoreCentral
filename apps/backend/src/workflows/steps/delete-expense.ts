import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ACCOUNTING_MODULE } from "../../modules/accounting"
import AccountingModuleService from "../../modules/accounting/service"

export type DeleteExpenseStepInput = { id: string }

// Soft delete: the row stays in the database but stops counting everywhere.
export const deleteExpenseStep = createStep(
  "delete-expense",
  async (input: DeleteExpenseStepInput, { container }) => {
    const accounting =
      container.resolve<AccountingModuleService>(ACCOUNTING_MODULE)
    // A bad or already-deleted id throws NOT_FOUND (404).
    const existing = await accounting.retrieveExpense(input.id)
    await accounting.softDeleteExpenses([existing.id])
    return new StepResponse({ id: existing.id }, existing.id)
  },
  async (expenseId, { container }) => {
    if (!expenseId) {
      return
    }
    await container
      .resolve<AccountingModuleService>(ACCOUNTING_MODULE)
      .restoreExpenses([expenseId])
  }
)
