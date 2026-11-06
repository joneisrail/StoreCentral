import type {
  AuthenticatedMedusaRequest,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { escapeLike } from "../../../modules/supplier/utils"
import { createInvoiceWorkflow } from "../../../workflows/create-invoice"
import { INVOICE_FIELDS, mapInvoice } from "./map-invoice"
import type { InvoiceRow } from "./map-invoice"
import type { CreateInvoiceSchema, ListInvoicesQuerySchema } from "./middlewares"
import { retrieveAdminInvoice } from "./retrieve-admin-invoice"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { purchase_id, supplier_id, status, q, limit, offset } =
    req.validatedQuery as unknown as ListInvoicesQuerySchema

  const filters: Record<string, unknown> = {}
  if (purchase_id) {
    filters.purchase_id = purchase_id
  }
  if (supplier_id) {
    filters.supplier_id = supplier_id
  }
  if (status) {
    filters.status = status
  }
  const term = q?.trim()
  if (term) {
    filters.$or = [{ invoice_number: { $ilike: `%${escapeLike(term)}%` } }]
  }

  const { data, metadata } = await query.graph({
    entity: "invoice",
    fields: INVOICE_FIELDS,
    filters,
    pagination: {
      take: limit,
      skip: offset,
      order: { created_at: "DESC", id: "DESC" },
    },
  })
  const rows = data as unknown as (InvoiceRow & {
    purchase?: { id: string; display_id: number } | null
  })[]

  // One query for every supplier on the page, not one per row.
  const supplierIds = [...new Set(rows.map((row) => row.supplier_id))]
  const suppliers = new Map<string, { id: string; name: string }>()
  if (supplierIds.length) {
    const { data: found } = await query.graph({
      entity: "supplier",
      fields: ["id", "name"],
      filters: { id: supplierIds },
      // take: null reads every row (typed as number only).
    pagination: { take: null as unknown as undefined },
    })
    for (const s of found as unknown as { id: string; name: string }[]) {
      suppliers.set(s.id, { id: s.id, name: s.name })
    }
  }

  const invoices = rows.map((row) =>
    mapInvoice(row, {
      supplier: suppliers.get(row.supplier_id) ?? null,
      purchase: row.purchase ?? null,
    })
  )

  res.json({
    invoices,
    count: metadata?.count ?? invoices.length,
    offset,
    limit,
  })
}

export async function POST(
  req: AuthenticatedMedusaRequest<CreateInvoiceSchema>,
  res: MedusaResponse
) {
  const { result } = await createInvoiceWorkflow(req.scope).run({
    input: req.validatedBody,
  })

  const invoice = await retrieveAdminInvoice(req.scope, result.invoice.id)

  res.json({ invoice })
}
