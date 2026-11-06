export type InvoiceStatus = "draft" | "posted" | "void"

export type AdminInvoiceItem = {
  id: string
  purchase_item_id: string | null
  variant_id: string
  // May be "" when the supplier has no SKU for the variant.
  supplier_sku: string
  description: string
  quantity: number
  unit_cost: number
  line_total: number
}

export type AdminInvoice = {
  id: string
  reference: string
  status: InvoiceStatus
  invoice_number: string
  // Calendar dates, "YYYY-MM-DD".
  invoice_date: string
  due_date: string | null
  supplier: { id: string; name: string } | null
  purchase: { id: string; reference: string } | null
  items: AdminInvoiceItem[]
  shipping_cost: number
  tax: number
  other_cost: number
  subtotal: number
  total: number
  notes: string | null
  posted_at: string | null
  voided_at: string | null
  created_at: string
}

export type InvoiceComparisonItem = {
  purchase_item_id: string | null
  variant_id: string
  title: string
  ordered_quantity: number
  received_quantity: number
  invoiced_quantity: number
  invoiced_quantity_total: number
  ordered_unit_cost: number | null
  invoiced_unit_cost: number | null
  flags: {
    price_difference: boolean
    over_received: boolean
    over_ordered: boolean
    not_on_purchase: boolean
  }
}

export type InvoiceComparison = {
  items: InvoiceComparisonItem[]
  purchase_total: number
  invoice_total: number
  difference: number
}
