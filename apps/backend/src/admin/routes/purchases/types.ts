export type PurchaseStatus =
  | "draft"
  | "ordered"
  | "partially_received"
  | "received"
  | "cancelled"

export type AdminPurchaseItem = {
  id: string
  variant_id: string
  sku: string
  title: string
  quantity: number
  quantity_received: number
  remaining: number
  unit_cost: number
}

export type AdminPurchaseReceipt = {
  id: string
  stock_location_id: string
  received_at: string
  note: string | null
  items: { purchase_item_id: string; quantity: number }[]
}

export type AdminPurchase = {
  id: string
  reference: string
  status: PurchaseStatus
  currency_code: string
  supplier: { id: string; name: string } | null
  items: AdminPurchaseItem[]
  receipts: AdminPurchaseReceipt[]
  shipping_cost: number
  tax: number
  other_cost: number
  subtotal: number
  total: number
  notes: string | null
  ordered_at: string | null
  created_at: string
}
