import type {
  AuthenticatedMedusaRequest,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { escapeLike } from "../../../modules/supplier/utils"
import { createInvoiceWorkflow } from "../../../workflows/create-invoice"
import { loadInvoicePayments } from "./invoice-payments"
import { INVOICE_FIELDS, mapInvoice } from "./map-invoice"
import type { InvoiceRow } from "./map-invoice"
import type { CreateInvoiceSchema, ListInvoicesQuerySchema } from "./middlewares"
import { retrieveAdminInvoice } from "./retrieve-admin-invoice"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const {
    purchase_id,
    supplier_id,
    status,
    payment_status,
    q,
    limit,
    offset,
  } =
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

  type Row = InvoiceRow & {
    purchase?: { id: string; display_id: number } | null
  }
  // take: null reads every row (typed as number only).
  const all = null as unknown as undefined
  const order = { created_at: "DESC", id: "DESC" } as const

  let rows: Row[]
  let count: number
  if (!payment_status) {
    const { data, metadata } = await query.graph({
      entity: "invoice",
      fields: INVOICE_FIELDS,
      filters,
      pagination: { take: limit, skip: offset, order },
    })
    rows = data as unknown as Row[]
    count = metadata?.count ?? rows.length
  } else {
    // payment_status is computed from the invoice total and its payments, so
    // the database cannot filter or paginate on it. Load every posted invoice
    // matching the other filters (draft and void invoices never match any
    // payment_status value) with the payments of all of them in one batched
    // read, compute with the shared helpers, then filter, sort
    // (created_at DESC, id DESC) and paginate in memory. count is the
    // filtered total.
    const { data } = await query.graph({
      entity: "invoice",
      fields: INVOICE_FIELDS,
      filters: { ...filters, status: status ?? "posted" },
      pagination: { take: all, order },
    })
    const candidates = data as unknown as Row[]
    const candidatePayments = await loadInvoicePayments(
      req.scope,
      candidates.map((row) => row.id)
    )
    const now = new Date()
    const matching = candidates
      .filter((row) => {
        const mapped = mapInvoice(
          row,
          { supplier: null, purchase: null },
          candidatePayments.get(row.id) ?? [],
          now
        )
        return payment_status === "overdue"
          ? mapped.overdue
          : mapped.payment_status === payment_status
      })
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime() ||
          (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
      )
    count = matching.length
    rows = matching.slice(offset, offset + limit)
  }

  // One query for every supplier on the page, not one per row.
  const supplierIds = [...new Set(rows.map((row) => row.supplier_id))]
  const suppliers = new Map<string, { id: string; name: string }>()
  if (supplierIds.length) {
    const { data: found } = await query.graph({
      entity: "supplier",
      fields: ["id", "name"],
      filters: { id: supplierIds },
      pagination: { take: all },
    })
    for (const s of found as unknown as { id: string; name: string }[]) {
      suppliers.set(s.id, { id: s.id, name: s.name })
    }
  }

  // One query for the payments of every invoice on the page.
  const payments = await loadInvoicePayments(
    req.scope,
    rows.map((row) => row.id)
  )
  const today = new Date()
  const invoices = rows.map((row) =>
    mapInvoice(
      row,
      {
        supplier: suppliers.get(row.supplier_id) ?? null,
        purchase: row.purchase ?? null,
      },
      payments.get(row.id) ?? [],
      today
    )
  )

  res.json({
    invoices,
    count,
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
