import type {
  AuthenticatedMedusaRequest,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ACCOUNTING_MODULE } from "../../../modules/accounting"
import type AccountingModuleService from "../../../modules/accounting/service"
import { toCents } from "../../../modules/accounting/utils"
import { escapeLike } from "../../../modules/supplier/utils"
import { createExpenseWorkflow } from "../../../workflows/create-expense"
import { mapExpense } from "./map-expense"
import type { ExpenseRow } from "./map-expense"
import type {
  CreateExpenseSchema,
  ListExpensesQuerySchema,
} from "./middlewares"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { category, from, to, q, limit, offset } =
    req.validatedQuery as unknown as ListExpensesQuerySchema

  const filters: Record<string, unknown> = {}
  if (category) {
    filters.category = category
  }
  // Inclusive on both ends: [from 00:00Z, the day after to 00:00Z).
  const range: Record<string, Date> = {}
  if (from) {
    range.$gte = new Date(`${from}T00:00:00.000Z`)
  }
  if (to) {
    range.$lt = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86400000)
  }
  if (from || to) {
    filters.expense_date = range
  }
  const term = q?.trim()
  if (term) {
    const pattern = `%${escapeLike(term)}%`
    filters.$or = [
      { description: { $ilike: pattern } },
      { payee: { $ilike: pattern } },
    ]
  }

  const accounting =
    req.scope.resolve<AccountingModuleService>(ACCOUNTING_MODULE)
  const [found, count] = await accounting.listAndCountExpenses(filters, {
    take: limit,
    skip: offset,
    order: { expense_date: "DESC", display_id: "DESC" },
  })

  // The total covers every match, not just this page; take: null reads all.
  const matching = (await accounting.listExpenses(filters, {
    take: null,
  })) as unknown as { amount: number | string }[]
  const totalCents = matching.reduce(
    (sum, e) => sum + toCents(Number(e.amount)),
    0
  )

  res.json({
    expenses: (found as unknown as ExpenseRow[]).map(mapExpense),
    count,
    offset,
    limit,
    total_amount: totalCents / 100,
  })
}

export async function POST(
  req: AuthenticatedMedusaRequest<CreateExpenseSchema>,
  res: MedusaResponse
) {
  const { result } = await createExpenseWorkflow(req.scope).run({
    input: req.validatedBody,
  })
  const accounting =
    req.scope.resolve<AccountingModuleService>(ACCOUNTING_MODULE)
  const row = await accounting.retrieveExpense(result.expense.id)
  res.json({ expense: mapExpense(row as unknown as ExpenseRow) })
}
