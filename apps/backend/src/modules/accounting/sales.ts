import { MedusaError } from "@medusajs/framework/utils"
import { toCents } from "./utils"

export type Granularity = "day" | "week" | "month"

// Money fields are `unknown`: query.graph may return numbers, strings or
// BigNumber-like objects. They are all read through Number().
export type SalesOrderInput = {
  created_at: string | Date
  item_subtotal: unknown
  discount_subtotal: unknown
  shipping_subtotal: unknown
  tax_total: unknown
  items: {
    variant_id: string | null
    product_id: string | null
    title: string
    quantity: unknown
    subtotal: unknown
    discount_subtotal: unknown
  }[]
}

export type SalesRefundInput = { created_at: string | Date; amount: unknown }

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
  range: { from: string; to: string; granularity: Granularity }
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

export const DAY_MS = 24 * 60 * 60 * 1000
const MAX_RANGE_DAYS = 366
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

const invalid = (message: string): never => {
  throw new MedusaError(MedusaError.Types.INVALID_DATA, message)
}

export const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

// Strict YYYY-MM-DD -> UTC midnight in ms; rejects 2026-02-30 and the like.
export const parseDay = (value: string, label: string): number => {
  const match = DATE_RE.exec(value ?? "")
  const ms = match
    ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : NaN
  if (!match || Number.isNaN(ms) || isoDay(ms) !== value) {
    return invalid(`"${label}" must be a valid date in YYYY-MM-DD format`)
  }
  return ms
}

export function resolveRange(
  input: { from?: string; to?: string },
  today: Date
): { from: string; to: string } {
  const todayMs = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  )
  let fromMs: number
  let toMs: number

  if (input.to) {
    toMs = parseDay(input.to, "to")
  } else {
    toMs = todayMs
  }
  if (input.from) {
    fromMs = parseDay(input.from, "from")
  } else {
    fromMs = toMs - 29 * DAY_MS
  }

  if (fromMs > toMs) {
    invalid('"from" must not be after "to"')
  }
  if ((toMs - fromMs) / DAY_MS + 1 > MAX_RANGE_DAYS) {
    invalid(`The date range must be at most ${MAX_RANGE_DAYS} days`)
  }
  return { from: isoDay(fromMs), to: isoDay(toMs) }
}

export const bucketKey = (ms: number, granularity: Granularity): string => {
  if (granularity === "month") {
    return isoDay(ms).slice(0, 7)
  }
  if (granularity === "week") {
    const sinceMonday = (new Date(ms).getUTCDay() + 6) % 7
    return isoDay(ms - sinceMonday * DAY_MS)
  }
  return isoDay(ms)
}

export const cents = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? toCents(n) : 0
}

type Acc = {
  orders: number
  units: number
  gross: number
  discounts: number
  shipping: number
  tax: number
  refunds: number
}

const emptyAcc = (): Acc => ({
  orders: 0,
  units: 0,
  gross: 0,
  discounts: 0,
  shipping: 0,
  tax: 0,
  refunds: 0,
})

const toTotals = (acc: Acc): SalesTotals => {
  const net = acc.gross - acc.discounts
  const revenue = net + acc.shipping
  return {
    orders: acc.orders,
    units: acc.units,
    gross_sales: acc.gross / 100,
    discounts: acc.discounts / 100,
    net_sales: net / 100,
    shipping: acc.shipping / 100,
    tax: acc.tax / 100,
    revenue: revenue / 100,
    refunds: acc.refunds / 100,
    net_revenue: (revenue - acc.refunds) / 100,
    average_order_value:
      acc.orders > 0 ? Math.round(revenue / acc.orders) / 100 : 0,
  }
}

export function buildSalesReport(input: {
  orders: SalesOrderInput[]
  refunds: SalesRefundInput[]
  from: string
  to: string
  granularity: Granularity
  top: number
}): SalesReport {
  const { granularity } = input
  const fromMs = parseDay(input.from, "from")
  const toMs = parseDay(input.to, "to")
  const endMs = toMs + DAY_MS

  // Every bucket in the range, ascending, pre-built so empty ones show zeros.
  const buckets = new Map<string, Acc>()
  for (let ms = fromMs; ms <= toMs; ms += DAY_MS) {
    const key = bucketKey(ms, granularity)
    if (!buckets.has(key)) {
      buckets.set(key, emptyAcc())
    }
  }

  const bucketFor = (createdAt: string | Date): Acc | undefined => {
    const ms = new Date(createdAt).getTime()
    if (Number.isNaN(ms) || ms < fromMs || ms >= endMs) {
      return undefined
    }
    return buckets.get(bucketKey(ms, granularity))
  }

  const products = new Map<
    string,
    {
      variant_id: string | null
      product_id: string | null
      title: string
      quantity: number
      revenue: number // cents
    }
  >()

  for (const order of input.orders) {
    const acc = bucketFor(order.created_at)
    if (!acc) {
      continue
    }
    acc.orders += 1
    acc.gross += cents(order.item_subtotal)
    acc.discounts += cents(order.discount_subtotal)
    acc.shipping += cents(order.shipping_subtotal)
    acc.tax += cents(order.tax_total)

    for (const line of order.items ?? []) {
      const quantity = Number.isFinite(Number(line.quantity))
        ? Number(line.quantity)
        : 0
      acc.units += quantity

      const key = line.variant_id
        ? `variant:${line.variant_id}`
        : `title:${line.title}`
      const group = products.get(key) ?? {
        variant_id: line.variant_id ?? null,
        product_id: line.product_id ?? null,
        title: line.title,
        quantity: 0,
        revenue: 0,
      }
      group.quantity += quantity
      group.revenue += cents(line.subtotal) - cents(line.discount_subtotal)
      products.set(key, group)
    }
  }

  for (const refund of input.refunds) {
    const acc = bucketFor(refund.created_at)
    if (acc) {
      acc.refunds += Math.abs(cents(refund.amount))
    }
  }

  const summaryAcc = emptyAcc()
  const trend = [...buckets.entries()].map(([period, acc]) => {
    for (const field of Object.keys(summaryAcc) as (keyof Acc)[]) {
      summaryAcc[field] += acc[field]
    }
    return { period, ...toTotals(acc) }
  })

  const top_products = [...products.values()]
    .sort(
      (a, b) =>
        b.revenue - a.revenue ||
        b.quantity - a.quantity ||
        (a.title < b.title ? -1 : a.title > b.title ? 1 : 0)
    )
    .slice(0, input.top)
    .map((p) => ({ ...p, revenue: p.revenue / 100 }))

  return {
    range: { from: input.from, to: input.to, granularity },
    currency_code: "usd",
    summary: toTotals(summaryAcc),
    trend,
    top_products,
  }
}
