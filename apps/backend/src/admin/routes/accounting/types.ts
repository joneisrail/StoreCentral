export type InvoiceStatus = "draft" | "posted" | "void"

export type InvoicePaymentStatus = "unpaid" | "partially_paid" | "paid"

export type PaymentMethod =
  | "bank_transfer"
  | "cash"
  | "card"
  | "cheque"
  | "other"

export type PaymentStatus = "recorded" | "void"

export type AdminPayment = {
  id: string
  // PAY-0001
  reference: string
  invoice: { id: string; reference: string; invoice_number: string } | null
  supplier: { id: string; name: string } | null
  amount: number
  // Calendar date, "YYYY-MM-DD".
  paid_at: string
  // Unknown values from the server are possible; render with the label helpers.
  method: PaymentMethod | (string & {})
  payment_reference: string | null
  note: string | null
  status: PaymentStatus | (string & {})
  voided_at: string | null
  created_at: string
}

export type SupplierBalance = {
  supplier: { id: string; name: string }
  invoiced_total: number
  paid_total: number
  balance_owed: number
  overdue_total: number
  open_invoices: number
}

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
  paid_total: number
  balance: number
  payment_status: InvoicePaymentStatus | null
  overdue: boolean
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

export type SalesGranularity = "day" | "week" | "month"

export type SalesTotals = {
  orders: number
  units: number
  gross_sales: number
  discounts: number
  net_sales: number
  shipping: number
  tax: number
  revenue: number
  refunds: number
  net_revenue: number
  average_order_value: number
}

export type SalesReport = {
  range: { from: string; to: string; granularity: SalesGranularity }
  currency_code: "usd"
  summary: SalesTotals
  trend: (SalesTotals & { period: string })[]
  top_products: {
    variant_id: string | null
    product_id: string | null
    title: string
    quantity: number
    revenue: number
  }[]
}

export type ProfitTotals = {
  orders: number
  units: number
  net_revenue: number
  cogs: number
  gross_profit: number
  // null when net revenue is zero or negative.
  margin_pct: number | null
  units_without_cost: number
}

export type ProfitReport = {
  range: { from: string; to: string; granularity: SalesGranularity }
  currency_code: "usd"
  summary: ProfitTotals
  trend: (ProfitTotals & { period: string })[]
  by_product: {
    variant_id: string | null
    product_id: string | null
    title: string
    units: number
    revenue: number
    cogs: number
    gross_profit: number
    margin_pct: number | null
    units_without_cost: number
  }[]
}

export type ExpenseCategory =
  | "rent"
  | "marketing"
  | "software"
  | "payroll"
  | "shipping_packaging"
  | "fees"
  | "utilities"
  | "other"

export type Expense = {
  id: string
  // EXP-0001
  reference: string
  // Calendar date, "YYYY-MM-DD".
  expense_date: string
  // Unknown values from the server are possible; render with expenseCategoryLabel.
  category: ExpenseCategory | (string & {})
  amount: number
  description: string
  payee: string | null
  currency_code: string
  created_at: string
}

export type ExpensesResponse = {
  expenses: Expense[]
  count: number
  offset: number
  limit: number
  // Sum over every match, not just the page.
  total_amount: number
}
