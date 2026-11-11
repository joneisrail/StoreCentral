import {
  DAY_MS,
  Granularity,
  SalesOrderInput,
  SalesRefundInput,
  bucketKey,
  buildSalesReport,
  cents,
  parseDay,
} from "./sales"

export type CostPurchase = {
  shipping_cost: unknown
  tax: unknown
  other_cost: unknown
  items: {
    id: string
    variant_id: string | null
    quantity: unknown
    unit_cost: unknown
  }[]
  receipts: {
    id: string
    received_at: string | Date
    items: { purchase_item_id: string; quantity: unknown }[]
  }[]
}

// cost_cents is the total landed cost of the receipt line, in cents.
export type CostEvent = { at: number; quantity: number; cost_cents: number }

export type ProfitTotals = {
  orders: number
  units: number
  net_revenue: number
  cogs: number
  gross_profit: number
  margin_pct: number | null
  units_without_cost: number
  expenses: number
  net_profit: number
  net_margin_pct: number | null
}

export type ExpenseInput = {
  expense_date: string | Date
  category: string
  amount: unknown
}

export type ProfitReport = {
  range: { from: string; to: string; granularity: Granularity }
  currency_code: "usd"
  summary: ProfitTotals
  trend: (ProfitTotals & { period: string })[]
  expenses_by_category: { category: string; amount: number }[]
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

const num = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

// Cents, not rounded, so fractional-cent unit costs keep their precision
// until the receipt line total is rounded once.
const rawCents = (value: unknown): number => num(value) * 100

export function buildCostEvents(
  purchases: CostPurchase[]
): Map<string, CostEvent[]> {
  const byVariant = new Map<string, (CostEvent & { id: string })[]>()

  for (const purchase of purchases) {
    const lines = purchase.items ?? []
    const subtotal = lines.reduce(
      (sum, l) => sum + num(l.quantity) * rawCents(l.unit_cost),
      0
    )
    const totalQuantity = lines.reduce((sum, l) => sum + num(l.quantity), 0)
    const extras =
      rawCents(purchase.shipping_cost) +
      rawCents(purchase.tax) +
      rawCents(purchase.other_cost)

    const landedUnitCents = (unitCost: unknown): number => {
      const unit = rawCents(unitCost)
      if (subtotal > 0) {
        return unit * (1 + extras / subtotal)
      }
      if (totalQuantity > 0) {
        return unit + extras / totalQuantity
      }
      return unit
    }

    const lineById = new Map(lines.map((l) => [l.id, l]))

    for (const receipt of purchase.receipts ?? []) {
      const at = new Date(receipt.received_at).getTime()
      if (Number.isNaN(at)) {
        continue
      }
      for (const [index, rl] of (receipt.items ?? []).entries()) {
        const line = lineById.get(rl.purchase_item_id)
        if (!line || !line.variant_id) {
          continue
        }
        const quantity = num(rl.quantity)
        const list = byVariant.get(line.variant_id) ?? []
        list.push({
          id: `${receipt.id}:${index}`,
          at,
          quantity,
          cost_cents: Math.round(quantity * landedUnitCents(line.unit_cost)),
        })
        byVariant.set(line.variant_id, list)
      }
    }
  }

  const result = new Map<string, CostEvent[]>()
  for (const [variantId, list] of byVariant) {
    list.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    result.set(
      variantId,
      list.map(({ at, quantity, cost_cents }) => ({ at, quantity, cost_cents }))
    )
  }
  return result
}

// Average landed cost per unit, in cents, over events at or before atMs.
// null when nothing has been received yet (the sale is uncosted).
export function averageUnitCostCents(
  events: CostEvent[] | undefined,
  atMs: number
): number | null {
  if (!events) {
    return null
  }
  let quantity = 0
  let cost = 0
  for (const event of events) {
    if (event.at > atMs) {
      break
    }
    quantity += event.quantity
    cost += event.cost_cents
  }
  return quantity > 0 ? cost / quantity : null
}

const margin = (profitCents: number, revenueCents: number): number | null =>
  revenueCents > 0 ? Math.round((profitCents / revenueCents) * 1000) / 10 : null

type CostAcc = { cogs: number; uncosted: number; expenses: number }

export function buildProfitReport(input: {
  orders: SalesOrderInput[]
  refunds: SalesRefundInput[]
  purchases: CostPurchase[]
  expenses: ExpenseInput[]
  from: string
  to: string
  granularity: Granularity
  top: number
}): ProfitReport {
  const { granularity } = input
  // Revenue, orders and units always come from Sales.
  const sales = buildSalesReport({
    orders: input.orders,
    refunds: input.refunds,
    from: input.from,
    to: input.to,
    granularity,
    top: 1,
  })

  const fromMs = parseDay(input.from, "from")
  const endMs = parseDay(input.to, "to") + DAY_MS
  const events = buildCostEvents(input.purchases)

  const buckets = new Map<string, CostAcc>()
  for (const row of sales.trend) {
    buckets.set(row.period, { cogs: 0, uncosted: 0, expenses: 0 })
  }
  const products = new Map<
    string,
    {
      variant_id: string | null
      product_id: string | null
      title: string
      units: number
      revenue: number
      cogs: number
      uncosted: number
    }
  >()

  for (const order of input.orders) {
    const ms = new Date(order.created_at).getTime()
    if (Number.isNaN(ms) || ms < fromMs || ms >= endMs) {
      continue
    }
    const acc = buckets.get(bucketKey(ms, granularity))
    if (!acc) {
      continue
    }
    for (const line of order.items ?? []) {
      const quantity = num(line.quantity)
      const average = line.variant_id
        ? averageUnitCostCents(events.get(line.variant_id), ms)
        : null
      const lineCost = average === null ? 0 : Math.round(quantity * average)
      const uncosted = average === null ? quantity : 0
      acc.cogs += lineCost
      acc.uncosted += uncosted

      const key = line.variant_id
        ? `variant:${line.variant_id}`
        : `title:${line.title}`
      const group = products.get(key) ?? {
        variant_id: line.variant_id ?? null,
        product_id: line.product_id ?? null,
        title: line.title,
        units: 0,
        revenue: 0,
        cogs: 0,
        uncosted: 0,
      }
      group.units += quantity
      group.revenue += cents(line.subtotal) - cents(line.discount_subtotal)
      group.cogs += lineCost
      group.uncosted += uncosted
      products.set(key, group)
    }
  }

  const categories = new Map<string, number>()
  for (const expense of input.expenses) {
    const ms = new Date(expense.expense_date).getTime()
    if (Number.isNaN(ms) || ms < fromMs || ms >= endMs) {
      continue
    }
    const acc = buckets.get(bucketKey(ms, granularity))
    if (!acc) {
      continue
    }
    const amount = cents(expense.amount)
    acc.expenses += amount
    categories.set(
      expense.category,
      (categories.get(expense.category) ?? 0) + amount
    )
  }

  let totalCogs = 0
  let totalUncosted = 0
  let totalExpenses = 0
  const trend = sales.trend.map((row) => {
    const acc = buckets.get(row.period) as CostAcc
    totalCogs += acc.cogs
    totalUncosted += acc.uncosted
    totalExpenses += acc.expenses
    const revenueCents = cents(row.net_revenue)
    const profitCents = revenueCents - acc.cogs
    const netCents = profitCents - acc.expenses
    return {
      period: row.period,
      orders: row.orders,
      units: row.units,
      net_revenue: row.net_revenue,
      cogs: acc.cogs / 100,
      gross_profit: profitCents / 100,
      margin_pct: margin(profitCents, revenueCents),
      units_without_cost: acc.uncosted,
      expenses: acc.expenses / 100,
      net_profit: netCents / 100,
      net_margin_pct: margin(netCents, revenueCents),
    }
  })

  const summaryRevenue = cents(sales.summary.net_revenue)
  const summaryProfit = summaryRevenue - totalCogs
  const summaryNet = summaryProfit - totalExpenses

  const expenses_by_category = [...categories.entries()]
    .filter(([, amount]) => amount !== 0)
    .sort(
      (a, b) =>
        b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
    )
    .map(([category, amount]) => ({ category, amount: amount / 100 }))

  const by_product = [...products.values()]
    .map((p) => ({ ...p, profit: p.revenue - p.cogs }))
    .sort(
      (a, b) =>
        b.profit - a.profit ||
        b.units - a.units ||
        (a.title < b.title ? -1 : a.title > b.title ? 1 : 0)
    )
    .slice(0, input.top)
    .map((p) => ({
      variant_id: p.variant_id,
      product_id: p.product_id,
      title: p.title,
      units: p.units,
      revenue: p.revenue / 100,
      cogs: p.cogs / 100,
      gross_profit: p.profit / 100,
      margin_pct: margin(p.profit, p.revenue),
      units_without_cost: p.uncosted,
    }))

  return {
    range: sales.range,
    currency_code: "usd",
    summary: {
      orders: sales.summary.orders,
      units: sales.summary.units,
      net_revenue: sales.summary.net_revenue,
      cogs: totalCogs / 100,
      gross_profit: summaryProfit / 100,
      margin_pct: margin(summaryProfit, summaryRevenue),
      units_without_cost: totalUncosted,
      expenses: totalExpenses / 100,
      net_profit: summaryNet / 100,
      net_margin_pct: margin(summaryNet, summaryRevenue),
    },
    trend,
    expenses_by_category,
    by_product,
  }
}
