import {
  calculatePurchaseTotals,
  formatPurchaseReference,
  getRemainingQuantity,
} from "../../../modules/purchase/utils"

export const PURCHASE_FIELDS = [
  "id",
  "display_id",
  "status",
  "currency_code",
  "shipping_cost",
  "tax",
  "other_cost",
  "notes",
  "ordered_at",
  "created_at",
  "items.*",
  "receipts.*",
  "receipts.items.*",
  "supplier.id",
  "supplier.name",
]

type Money = number | string

export type PurchaseRow = {
  id: string
  display_id: number
  status: string
  currency_code: string
  shipping_cost: Money
  tax: Money
  other_cost: Money
  notes: string | null
  ordered_at: string | Date | null
  created_at: string | Date
  items: {
    id: string
    variant_id: string
    sku: string
    title: string
    quantity: number
    quantity_received: number
    unit_cost: Money
  }[]
  receipts: {
    id: string
    stock_location_id: string
    received_at: string | Date
    note: string | null
    items: { purchase_item_id: string; quantity: number }[]
  }[]
}

export type AdminPurchase = {
  id: string
  reference: string
  status: string
  currency_code: string
  supplier: { id: string; name: string } | null
  items: {
    id: string
    variant_id: string
    sku: string
    title: string
    quantity: number
    quantity_received: number
    remaining: number
    unit_cost: number
  }[]
  receipts: {
    id: string
    stock_location_id: string
    received_at: string | Date
    note: string | null
    items: { purchase_item_id: string; quantity: number }[]
  }[]
  shipping_cost: number
  tax: number
  other_cost: number
  subtotal: number
  total: number
  notes: string | null
  ordered_at: string | Date | null
  created_at: string | Date
}

export const mapPurchaseForAdmin = (
  purchase: PurchaseRow,
  supplier: { id: string; name: string } | null
): AdminPurchase => {
  const items = (purchase.items ?? []).map((item) => ({
    id: item.id,
    variant_id: item.variant_id,
    sku: item.sku,
    title: item.title,
    quantity: item.quantity,
    quantity_received: item.quantity_received,
    remaining: getRemainingQuantity(item),
    unit_cost: Number(item.unit_cost),
  }))

  const shipping_cost = Number(purchase.shipping_cost)
  const tax = Number(purchase.tax)
  const other_cost = Number(purchase.other_cost)
  const { subtotal, total } = calculatePurchaseTotals(items, {
    shipping_cost,
    tax,
    other_cost,
  })

  return {
    id: purchase.id,
    reference: formatPurchaseReference(purchase.display_id),
    status: purchase.status,
    currency_code: purchase.currency_code,
    supplier,
    items,
    receipts: (purchase.receipts ?? []).map((receipt) => ({
      id: receipt.id,
      stock_location_id: receipt.stock_location_id,
      received_at: receipt.received_at,
      note: receipt.note,
      items: (receipt.items ?? []).map((line) => ({
        purchase_item_id: line.purchase_item_id,
        quantity: line.quantity,
      })),
    })),
    shipping_cost,
    tax,
    other_cost,
    subtotal,
    total,
    notes: purchase.notes,
    ordered_at: purchase.ordered_at,
    created_at: purchase.created_at,
  }
}
