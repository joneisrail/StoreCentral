import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  TRENDING_WINDOW_DAYS,
  clampLimit,
  rankTrending,
  sumUnits,
} from "./helpers"

const ORDER_PAGE = 1000

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const limit = clampLimit((req.query as Record<string, unknown>).limit)
  const channelIds: string[] =
    (req as any).publishable_key_context?.sales_channel_ids ?? []
  const since = new Date(
    Date.now() - TRENDING_WINDOW_DAYS * 24 * 60 * 60 * 1000
  )

  const visible: Record<string, unknown> = { status: "published" }
  if (channelIds.length) visible.sales_channels = { id: channelIds }

  const items: { product_id?: string | null; quantity?: number | null }[] = []
  for (let skip = 0; ; skip += ORDER_PAGE) {
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "items.product_id", "items.quantity"],
      filters: {
        created_at: { $gte: since },
        status: { $ne: "canceled" },
        is_draft_order: false,
      },
      pagination: { skip, take: ORDER_PAGE, order: { created_at: "ASC" } },
    })
    for (const o of orders as any[]) {
      for (const i of o.items ?? []) if (i) items.push(i)
    }
    if (orders.length < ORDER_PAGE) break
  }

  const sold = sumUnits(items)
  const eligible = new Set<string>()
  if (sold.length) {
    const { data } = await query.graph({
      entity: "product",
      fields: ["id"],
      filters: { ...visible, id: sold.map((s) => s.product_id) },
    })
    for (const p of data as any[]) eligible.add(p.id)
  }

  const { data: newest } = await query.graph({
    entity: "product",
    fields: ["id"],
    filters: visible,
    pagination: { take: limit * 2, order: { created_at: "DESC" } },
  })

  const ids = rankTrending(
    sold,
    eligible,
    (newest as any[]).map((p) => p.id),
    limit
  )

  const { data: found } = ids.length
    ? await query.graph({
        entity: "product",
        fields: ["id", "title", "handle", "thumbnail"],
        filters: { id: ids },
      })
    : { data: [] as any[] }
  const byId = new Map((found as any[]).map((p) => [p.id, p]))
  const products = ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((p: any) => ({
      id: p.id,
      title: p.title,
      handle: p.handle,
      thumbnail: p.thumbnail ?? null,
    }))

  res.setHeader("Cache-Control", "public, max-age=300")
  res.json({ products })
}
