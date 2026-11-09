import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { loadInvoicePayments } from "../invoices/invoice-payments"
import { INVOICE_FIELDS } from "../invoices/map-invoice"
import type { InvoiceRow } from "../invoices/map-invoice"
import { calculateInvoiceTotals } from "../../../modules/accounting/utils"
import type { ListSupplierBalancesQuerySchema } from "./middlewares"
import { summarizeBalances } from "./summarize-balances"

const UNKNOWN_SUPPLIER = "(unknown supplier)"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { q, limit, offset } =
    req.validatedQuery as unknown as ListSupplierBalancesQuerySchema

  // take: null reads every row (typed as number only).
  const all = null as unknown as undefined

  // Every posted invoice, with its items, then the payments of all of them in
  // one batched read.
  const { data } = await query.graph({
    entity: "invoice",
    fields: INVOICE_FIELDS,
    filters: { status: "posted" },
    pagination: { take: all },
  })
  const invoices = data as unknown as InvoiceRow[]
  const payments = await loadInvoicePayments(
    req.scope,
    invoices.map((invoice) => invoice.id)
  )

  const rows = summarizeBalances(
    invoices.map((invoice) => ({
      supplier_id: invoice.supplier_id,
      status: invoice.status,
      total: calculateInvoiceTotals(
        (invoice.items ?? []).map((item) => ({
          quantity: item.quantity,
          unit_cost: Number(item.unit_cost),
        })),
        {
          shipping_cost: Number(invoice.shipping_cost),
          tax: Number(invoice.tax),
          other_cost: Number(invoice.other_cost),
        }
      ).total,
      due_date: invoice.due_date,
      payments: (payments.get(invoice.id) ?? []).map((p) => ({
        amount: Number(p.amount),
        status: p.status,
      })),
    })),
    new Date()
  )

  // One query for every supplier with a posted invoice.
  const supplierIds = rows.map((row) => row.supplier_id)
  const names = new Map<string, string>()
  if (supplierIds.length) {
    const { data: found } = await query.graph({
      entity: "supplier",
      fields: ["id", "name"],
      filters: { id: supplierIds },
      pagination: { take: all },
    })
    for (const s of found as unknown as { id: string; name: string }[]) {
      names.set(s.id, s.name)
    }
  }

  const withNames = rows.map(({ supplier_id, ...rest }) => ({
    supplier: { id: supplier_id, name: names.get(supplier_id) ?? UNKNOWN_SUPPLIER },
    ...rest,
  }))

  // Case-insensitive literal substring match on the name (so % and _ are
  // ordinary characters); whitespace-only is ignored.
  const term = q?.trim().toLowerCase()
  const matching = term
    ? withNames.filter((row) => row.supplier.name.toLowerCase().includes(term))
    : withNames

  res.json({
    balances: matching.slice(offset, offset + limit),
    count: matching.length,
    offset,
    limit,
  })
}
