import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

// Money values from query.graph may be numbers, strings or BigNumber-like
// objects; callers apply Number().
export type RawOrder = {
  id: string
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

export type RawRefund = { created_at: string | Date; amount: unknown }

const PAGE_SIZE = 500
const DAY_MS = 24 * 60 * 60 * 1000

const ORDER_FIELDS = [
  "id",
  "created_at",
  "item_subtotal",
  "discount_subtotal",
  "shipping_subtotal",
  "tax_total",
  "items.variant_id",
  "items.product_id",
  "items.title",
  "items.quantity",
  "items.subtotal",
  "items.discount_subtotal",
]

type RefundRow = RawRefund & {
  order?: { status?: string | null; canceled_at?: unknown } | null
}

function bounds(range: { from: string; to: string }) {
  const start = new Date(`${range.from}T00:00:00.000Z`)
  const end = new Date(new Date(`${range.to}T00:00:00.000Z`).getTime() + DAY_MS)
  return { start, end }
}

async function readPages<T>(
  read: (skip: number) => Promise<T[]>
): Promise<T[]> {
  const all: T[] = []
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const page = await read(skip)
    all.push(...page)
    if (page.length < PAGE_SIZE) {
      return all
    }
  }
}

export async function loadSalesData(
  scope: MedusaContainer,
  range: { from: string; to: string }
): Promise<{ orders: RawOrder[]; refunds: RawRefund[] }> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { start, end } = bounds(range)

  const orders = await readPages<RawOrder>(async (skip) => {
    const { data } = await query.graph({
      entity: "order",
      fields: ORDER_FIELDS,
      filters: {
        created_at: { $gte: start, $lt: end },
        currency_code: "usd",
        canceled_at: null,
        status: { $nin: ["canceled", "draft"] },
      },
      pagination: {
        skip,
        take: PAGE_SIZE,
        order: { created_at: "ASC", id: "ASC" },
      },
    } as any)
    return data as unknown as RawOrder[]
  })

  const rows = await readPages<RefundRow>(async (skip) => {
    const { data } = await query.graph({
      entity: "order_transaction",
      fields: ["id", "created_at", "amount", "order.status", "order.canceled_at"],
      filters: {
        reference: "refund",
        currency_code: "usd",
        created_at: { $gte: start, $lt: end },
      },
      pagination: {
        skip,
        take: PAGE_SIZE,
        order: { created_at: "ASC", id: "ASC" },
      },
    } as any)
    return data as unknown as RefundRow[]
  })

  const refunds = rows
    .filter(
      (row) =>
        row.order &&
        !row.order.canceled_at &&
        row.order.status !== "canceled" &&
        row.order.status !== "draft"
    )
    .map(({ created_at, amount }) => ({ created_at, amount }))

  return { orders, refunds }
}
