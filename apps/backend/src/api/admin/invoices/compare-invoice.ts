export type CompareInput = {
  purchase_items: {
    id: string
    variant_id: string
    title: string
    quantity: number
    quantity_received: number
    unit_cost: number
  }[]
  lines: {
    purchase_item_id: string | null
    variant_id: string
    description: string
    quantity: number
    unit_cost: number
  }[]
  other_invoiced: { purchase_item_id: string; quantity: number }[]
  purchase_total: number
  invoice_total: number
}

export type ComparisonItem = {
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

export type Comparison = {
  items: ComparisonItem[]
  purchase_total: number
  invoice_total: number
  difference: number
}

const round = (value: number): number => Math.round(value * 100) / 100

// Compares an invoice against its purchase. Pure: callers pass plain numbers.
export const compareInvoice = (input: CompareInput): Comparison => {
  const otherByItem = new Map<string, number>()
  for (const other of input.other_invoiced) {
    otherByItem.set(
      other.purchase_item_id,
      (otherByItem.get(other.purchase_item_id) ?? 0) + other.quantity
    )
  }

  const linesByItem = new Map<string, CompareInput["lines"]>()
  const extraLines: CompareInput["lines"] = []
  for (const l of input.lines) {
    if (l.purchase_item_id === null) {
      extraLines.push(l)
    } else {
      const list = linesByItem.get(l.purchase_item_id) ?? []
      list.push(l)
      linesByItem.set(l.purchase_item_id, list)
    }
  }

  const items: ComparisonItem[] = input.purchase_items.map((pi) => {
    const lines = linesByItem.get(pi.id) ?? []
    const invoiced_quantity = lines.reduce((sum, l) => sum + l.quantity, 0)
    const invoiced_quantity_total =
      invoiced_quantity + (otherByItem.get(pi.id) ?? 0)

    let invoiced_unit_cost: number | null = null
    let price_difference = false
    if (lines.length) {
      const costs = new Set(lines.map((l) => round(l.unit_cost)))
      invoiced_unit_cost =
        costs.size === 1
          ? lines[0].unit_cost
          : round(
              lines.reduce((sum, l) => sum + l.quantity * l.unit_cost, 0) /
                invoiced_quantity
            )
      price_difference = lines.some(
        (l) => round(l.unit_cost) !== round(pi.unit_cost)
      )
    }

    return {
      purchase_item_id: pi.id,
      variant_id: pi.variant_id,
      title: pi.title,
      ordered_quantity: pi.quantity,
      received_quantity: pi.quantity_received,
      invoiced_quantity,
      invoiced_quantity_total,
      ordered_unit_cost: pi.unit_cost,
      invoiced_unit_cost,
      flags: {
        price_difference,
        over_received: invoiced_quantity_total > pi.quantity_received,
        over_ordered: invoiced_quantity_total > pi.quantity,
        not_on_purchase: false,
      },
    }
  })

  for (const l of extraLines) {
    items.push({
      purchase_item_id: null,
      variant_id: l.variant_id,
      title: l.description,
      ordered_quantity: 0,
      received_quantity: 0,
      invoiced_quantity: l.quantity,
      invoiced_quantity_total: l.quantity,
      ordered_unit_cost: null,
      invoiced_unit_cost: l.unit_cost,
      flags: {
        price_difference: false,
        over_received: false,
        over_ordered: false,
        not_on_purchase: true,
      },
    })
  }

  return {
    items,
    purchase_total: input.purchase_total,
    invoice_total: input.invoice_total,
    difference: round(input.invoice_total - input.purchase_total),
  }
}
