import type { MedusaContainer } from "@medusajs/framework/types"
import { ACCOUNTING_MODULE } from "../../../modules/accounting"
import type AccountingModuleService from "../../../modules/accounting/service"
import type { ExpenseInput } from "../../../modules/accounting/profit"
import { DAY_MS } from "../../../modules/accounting/sales"

// Expenses dated from 00:00 UTC of `from` up to, but not including, 00:00 UTC
// of the day after `to`. Read through the accounting service (query.graph
// cannot read module entities by name); take: null reads every match, not the
// service's default page. Deleted expenses are soft-deleted and never listed.
export async function loadExpenseData(
  scope: MedusaContainer,
  range: { from: string; to: string }
): Promise<ExpenseInput[]> {
  const start = new Date(`${range.from}T00:00:00.000Z`)
  const endExclusive = new Date(
    new Date(`${range.to}T00:00:00.000Z`).getTime() + DAY_MS
  )

  const rows = await scope
    .resolve<AccountingModuleService>(ACCOUNTING_MODULE)
    .listExpenses(
      { expense_date: { $gte: start, $lt: endExclusive } },
      { take: null }
    )
  return rows as unknown as ExpenseInput[]
}
