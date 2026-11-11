import type {
  AuthenticatedMedusaRequest,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ACCOUNTING_MODULE } from "../../../../modules/accounting"
import type AccountingModuleService from "../../../../modules/accounting/service"
import { deleteExpenseWorkflow } from "../../../../workflows/delete-expense"
import { updateExpenseWorkflow } from "../../../../workflows/update-expense"
import { mapExpense } from "../map-expense"
import type { ExpenseRow } from "../map-expense"
import type { UpdateExpenseSchema } from "../middlewares"

const retrieve = async (req: MedusaRequest, id: string) => {
  const accounting =
    req.scope.resolve<AccountingModuleService>(ACCOUNTING_MODULE)
  // A missing or deleted expense throws NOT_FOUND (404).
  const row = await accounting.retrieveExpense(id)
  return mapExpense(row as unknown as ExpenseRow)
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  res.json({ expense: await retrieve(req, req.params.id) })
}

export async function POST(
  req: AuthenticatedMedusaRequest<UpdateExpenseSchema>,
  res: MedusaResponse
) {
  await updateExpenseWorkflow(req.scope).run({
    input: { ...req.validatedBody, id: req.params.id },
  })
  res.json({ expense: await retrieve(req, req.params.id) })
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  await deleteExpenseWorkflow(req.scope).run({ input: { id: req.params.id } })
  res.json({ id: req.params.id, object: "expense", deleted: true })
}
