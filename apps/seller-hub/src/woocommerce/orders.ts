import { PermanentSyncError } from "../queue/queues.js"
import type { WooCommerceClient } from "./client.js"

export type NormalizedWooOrder = {
  wooOrderId: string
  status: string
  currencyCode: string
  buyerEmail: string
  items: { sku: string; quantity: number; unitPrice: number }[]
  shippingAddress: {
    first_name: string
    last_name: string
    address_1: string
    city: string
    country_code: string
    postal_code: string
  }
}

const bad = (what: string): never => {
  throw new PermanentSyncError(`Malformed WooCommerce order: ${what}`)
}

const str = (v: unknown): string => (typeof v === "string" ? v : "")

const isEmptyAddress = (a: Record<string, unknown>): boolean =>
  ["first_name", "last_name", "address_1", "city", "country", "postcode"].every(
    (k) => str(a[k]).trim() === ""
  )

/**
 * Normalizes a WooCommerce REST order. Only `line_items` become items (tax,
 * shipping and fee lines never do). The unit price is the line `total` (after
 * discounts, tax excluded) divided by quantity, rounded to a cent. A line
 * without a SKU is kept with `sku: ""` so the importer can fail it cleanly.
 */
export const normalizeWooOrder = (raw: unknown): NormalizedWooOrder => {
  if (typeof raw !== "object" || raw === null) return bad("not an object")
  const o = raw as Record<string, any>

  if (
    !(typeof o.id === "number" && Number.isFinite(o.id)) &&
    !(typeof o.id === "string" && o.id !== "")
  ) {
    return bad("missing id")
  }
  if (!Array.isArray(o.line_items)) return bad("missing line items")

  const items = o.line_items.map((n: any) => {
    const quantity = n?.quantity
    const total = typeof n?.total === "string" ? Number(n.total) : NaN
    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(total)
    ) {
      return bad("invalid line item")
    }
    return {
      sku: str(n.sku).trim(),
      quantity,
      unitPrice: Math.round((total / quantity) * 100) / 100,
    }
  })

  const billing: Record<string, unknown> =
    typeof o.billing === "object" && o.billing !== null ? o.billing : {}
  const shipping: Record<string, unknown> =
    typeof o.shipping === "object" && o.shipping !== null ? o.shipping : {}
  const a = isEmptyAddress(shipping) ? billing : shipping

  return {
    wooOrderId: String(o.id),
    status: str(o.status),
    currencyCode: str(o.currency),
    buyerEmail: str(billing.email),
    items,
    shippingAddress: {
      first_name: str(a.first_name),
      last_name: str(a.last_name),
      address_1: str(a.address_1),
      city: str(a.city),
      country_code: str(a.country),
      postal_code: str(a.postcode),
    },
  }
}

/** Fetches and normalizes a single order by its numeric id. */
export const fetchWooOrder = async (
  client: WooCommerceClient,
  id: string
): Promise<NormalizedWooOrder> => {
  const { data } = await client.request<unknown>(
    "GET",
    `/orders/${encodeURIComponent(id)}`
  )
  return normalizeWooOrder(data)
}

/** Ids of every order modified at or after `sinceIso`, any status. */
export const fetchWooOrdersModifiedSince = async (
  client: WooCommerceClient,
  sinceIso: string
): Promise<{ wooOrderId: string }[]> => {
  const out: { wooOrderId: string }[] = []
  let page = 1
  while (true) {
    const { data, totalPages } = await client.request<{ id: number | string }[]>(
      "GET",
      "/orders",
      {
        query: {
          modified_after: sinceIso,
          status: "any",
          per_page: 100,
          page,
        },
      }
    )
    for (const o of data) out.push({ wooOrderId: String(o.id) })
    if (page >= totalPages) return out
    page += 1
  }
}
