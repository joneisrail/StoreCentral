export type Supplier = {
  id: string
  name: string
  email: string | null
  phone: string | null
  address: string | null
  notes: string | null
  contact_name: string | null
  website: string | null
  tax_id: string | null
  payment_terms: string | null
  lead_time_days: number | null
  is_active: boolean
  created_at: string
}

export type SupplierProductRow = {
  id: string
  supplier_id: string
  variant_id: string
  supplier_sku: string
  supplier_title: string | null
  unit_cost: number | null
  notes: string | null
  variant: {
    id: string
    title: string | null
    sku: string | null
    product: { id: string; title: string } | null
  } | null
}

export type SupplierSummary = {
  counts: Record<string, number>
  total_ordered: number
  total_received: number
  outstanding: number
}
