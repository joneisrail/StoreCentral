import type { AdminPurchaseItem } from "../../../purchases/types"
import type { AdminInvoice } from "../../types"

// Amounts are plain dollar values, never cents. Quantity and cost are kept as
// the text the admin typed and only parsed (strictly) when they are used.
export type Line = {
  key: string
  purchase_item_id: string | null
  variant_id: string | null
  // The supplier's code. "" when unknown (for example a prefilled line).
  supplier_sku: string
  remember_code: boolean
  label: string
  quantity: string
  unit_cost: string
}

export type InvoiceFormState = {
  purchase_id: string
  invoice_number: string
  invoice_date: string
  due_date: string
  shipping_cost: string
  tax: string
  other_cost: string
  notes: string
  lines: Line[]
}

export type CreateInvoiceBody = {
  purchase_id: string
  invoice_number: string
  invoice_date: string
  due_date?: string
  shipping_cost: number
  tax: number
  other_cost: number
  notes?: string
  items: {
    purchase_item_id?: string
    variant_id?: string
    supplier_sku?: string
    remember_code?: boolean
    quantity: number
    unit_cost: number
  }[]
}

// Whole numbers of 1 or more. Anything unreadable is null, never "cleared".
export function parseQuantity(value: string): number | null {
  const text = value.trim()
  if (!/^\d+$/.test(text)) {
    return null
  }
  const quantity = Number(text)
  return Number.isSafeInteger(quantity) && quantity >= 1 ? quantity : null
}

// A plain decimal number of 0 or more.
export function parseCost(value: string): number | null {
  const text = value.trim()
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(text)) {
    return null
  }
  const cost = Number(text)
  return Number.isFinite(cost) ? cost : null
}

// A blank optional amount counts as 0; anything else must be a valid amount.
export function parseOptionalAmount(value: string): number | null {
  return value.trim() === "" ? 0 : parseCost(value)
}

export function isLineValid(line: Line): boolean {
  return parseQuantity(line.quantity) !== null && parseCost(line.unit_cost) !== null
}

let lineCounter = 0
export function newLineKey() {
  lineCounter += 1
  return `line_${lineCounter}`
}

// Lines for what is still uninvoiced on the purchase: ordered quantity minus
// what non-void invoices already bill for the same purchase item.
export function prefillLines(
  purchaseItems: AdminPurchaseItem[],
  existingInvoices: AdminInvoice[]
): Line[] {
  const invoiced = new Map<string, number>()
  for (const invoice of existingInvoices) {
    if (invoice.status === "void") {
      continue
    }
    for (const item of invoice.items) {
      if (item.purchase_item_id) {
        invoiced.set(
          item.purchase_item_id,
          (invoiced.get(item.purchase_item_id) ?? 0) + item.quantity
        )
      }
    }
  }

  const lines: Line[] = []
  for (const item of purchaseItems) {
    const quantity = Math.max(0, item.quantity - (invoiced.get(item.id) ?? 0))
    if (quantity === 0) {
      continue
    }
    lines.push({
      key: newLineKey(),
      purchase_item_id: item.id,
      variant_id: item.variant_id,
      supplier_sku: "",
      remember_code: false,
      label: item.title,
      quantity: String(quantity),
      unit_cost: String(item.unit_cost),
    })
  }
  return lines
}

// Builds the POST /admin/invoices body. The state must be valid (see
// isLineValid and the header checks on the page); otherwise this throws.
export function buildCreateBody(state: InvoiceFormState): CreateInvoiceBody {
  const shipping = parseOptionalAmount(state.shipping_cost)
  const tax = parseOptionalAmount(state.tax)
  const other = parseOptionalAmount(state.other_cost)
  if (shipping === null || tax === null || other === null) {
    throw new Error("Shipping, tax and other cost must be amounts of 0 or more.")
  }

  const items = state.lines.map((line) => {
    const quantity = parseQuantity(line.quantity)
    const unit_cost = parseCost(line.unit_cost)
    if (quantity === null || unit_cost === null) {
      throw new Error("Every line needs a whole quantity and a cost.")
    }
    const item: CreateInvoiceBody["items"][number] = { quantity, unit_cost }
    if (line.purchase_item_id) {
      item.purchase_item_id = line.purchase_item_id
    }
    if (line.variant_id) {
      item.variant_id = line.variant_id
    }
    if (line.supplier_sku.trim()) {
      item.supplier_sku = line.supplier_sku.trim()
    }
    if (line.remember_code) {
      item.remember_code = true
    }
    return item
  })

  const body: CreateInvoiceBody = {
    purchase_id: state.purchase_id,
    invoice_number: state.invoice_number.trim(),
    invoice_date: state.invoice_date,
    shipping_cost: shipping,
    tax,
    other_cost: other,
    items,
  }
  if (state.due_date) {
    body.due_date = state.due_date
  }
  if (state.notes.trim()) {
    body.notes = state.notes.trim()
  }
  return body
}

export type LineWarnings = {
  price_difference: boolean
  over_ordered: boolean
  over_received: boolean
  not_on_purchase: boolean
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

// Local mirror of the server's comparison flags. Billed quantity counts every
// line of this form for the purchase item plus other invoices' lines.
export function lineWarnings(
  lines: Line[],
  purchaseItems: AdminPurchaseItem[],
  existingInvoices: AdminInvoice[]
): Map<string, LineWarnings> {
  const billed = new Map<string, number>()
  for (const invoice of existingInvoices) {
    if (invoice.status === "void") {
      continue
    }
    for (const item of invoice.items) {
      if (item.purchase_item_id) {
        billed.set(
          item.purchase_item_id,
          (billed.get(item.purchase_item_id) ?? 0) + item.quantity
        )
      }
    }
  }
  for (const line of lines) {
    const quantity = parseQuantity(line.quantity)
    if (line.purchase_item_id && quantity !== null) {
      billed.set(
        line.purchase_item_id,
        (billed.get(line.purchase_item_id) ?? 0) + quantity
      )
    }
  }

  const result = new Map<string, LineWarnings>()
  for (const line of lines) {
    const purchaseItem = line.purchase_item_id
      ? purchaseItems.find((p) => p.id === line.purchase_item_id)
      : undefined
    if (!purchaseItem) {
      result.set(line.key, {
        price_difference: false,
        over_ordered: false,
        over_received: false,
        not_on_purchase: true,
      })
      continue
    }
    const cost = parseCost(line.unit_cost)
    const total = billed.get(purchaseItem.id) ?? 0
    result.set(line.key, {
      price_difference:
        cost !== null && round2(cost) !== round2(purchaseItem.unit_cost),
      over_ordered: total > purchaseItem.quantity,
      over_received: total > purchaseItem.quantity_received,
      not_on_purchase: false,
    })
  }
  return result
}
