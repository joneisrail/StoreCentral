import type {
  AuthenticatedMedusaRequest,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ACCOUNTING_MODULE } from "../../../modules/accounting"
import type AccountingModuleService from "../../../modules/accounting/service"
import { escapeLike } from "../../../modules/supplier/utils"
import { recordPaymentWorkflow } from "../../../workflows/record-payment"
import { mapPayment } from "./map-payment"
import type { PaymentExtras, PaymentRow } from "./map-payment"
import type { ListPaymentsQuerySchema, RecordPaymentSchema } from "./middlewares"
import {
  loadPaymentExtras,
  retrieveAdminPayment,
} from "./retrieve-admin-payment"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { invoice_id, supplier_id, status, method, q, limit, offset } =
    req.validatedQuery as unknown as ListPaymentsQuerySchema

  const filters: Record<string, unknown> = {}
  if (invoice_id) {
    filters.invoice_id = invoice_id
  }
  if (supplier_id) {
    filters.supplier_id = supplier_id
  }
  if (status) {
    filters.status = status
  }
  if (method) {
    filters.method = method
  }
  const term = q?.trim()
  if (term) {
    filters.reference = { $ilike: `%${escapeLike(term)}%` }
  }

  // Read through the accounting service: query.graph looks for a
  // listSupplierPayments method, but the service key is Payment.
  const accounting =
    req.scope.resolve<AccountingModuleService>(ACCOUNTING_MODULE)
  const [found, total] = await accounting.listAndCountPayments(filters, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC", id: "DESC" },
  })
  const rows = found as unknown as PaymentRow[]
  const extras = await loadPaymentExtras(req.scope, rows)

  const payments = rows.map((row) =>
    mapPayment(row, extras.get(row.id) as PaymentExtras)
  )

  res.json({
    payments,
    count: total,
    offset,
    limit,
  })
}

export async function POST(
  req: AuthenticatedMedusaRequest<RecordPaymentSchema>,
  res: MedusaResponse
) {
  const { result } = await recordPaymentWorkflow(req.scope).run({
    input: req.validatedBody,
  })

  res.json({
    payment: await retrieveAdminPayment(req.scope, result.payment.id),
  })
}
