import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  MAX_ORDER_PAGES,
  TRENDING_TTL_MS,
  TRENDING_WINDOW_DAYS,
  clampLimit,
  createTtlCache,
  loadOrDegrade,
  rankTrending,
  sumUnits,
  trendingCacheKey,
} from "./helpers"

const ORDER_PAGE = 1000
const cache = createTtlCache<TrendingProduct[]>(Date.now, TRENDING_TTL_MS)

type TrendingProduct = {
  id: string
  title: string
  handle: string
  thumbnail: string | null
}

async function loadTrending(
  req: MedusaRequest,
  channelIds: string[],
  limit: number
): Promise<TrendingProduct[]> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const since = new Date(
    Date.now() - TRENDING_WINDOW_DAYS * 24 * 60 * 60 * 1000
  )

  const visible: Record<string, unknown> = { status: "published" }
  visible.sales_channels = { id: channelIds }

  const items: { product_id?: string | null; quantity?: number | null }[] = []
  for (let page = 0; ; page++) {
    const skip = page * ORDER_PAGE
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "items.product_id", "items.quantity"],
      filters: {
        created_at: { $gte: since },
        status: { $ne: "canceled" },
        is_draft_order: false,
      },
      // Newest first, so when the scan hits MAX_ORDER_PAGES it keeps the most
      // recent orders of the window rather than the oldest.
      pagination: { skip, take: ORDER_PAGE, order: { created_at: "DESC" } },
    })
    for (const o of orders as any[]) {
      for (const i of o.items ?? []) if (i) items.push(i)
    }
    if (orders.length < ORDER_PAGE) break
    if (page + 1 >= MAX_ORDER_PAGES) {
      const logger: any = req.scope.resolve("logger")
      logger.warn(
        `[search-trending] order scan capped at ${MAX_ORDER_PAGES} pages`
      )
      break
    }
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
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((p: any) => ({
      id: p.id,
      title: p.title,
      handle: p.handle,
      thumbnail: p.thumbnail ?? null,
    }))

}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const logger: any = req.scope.resolve("logger")
  const limit = clampLimit((req.query as Record<string, unknown>).limit)
  const channelIds: string[] =
    (req as any).publishable_key_context?.sales_channel_ids ?? []

  // Fail closed: without a channel scope nothing is visible.
  if (!channelIds.length) {
    res.setHeader("Cache-Control", "public, max-age=300")
    return res.json({ products: [] })
  }

  const { value, degraded } = await loadOrDegrade(
    () =>
      cache.getOrLoad(trendingCacheKey(channelIds, limit), () =>
        loadTrending(req, channelIds, limit)
      ),
    [] as TrendingProduct[],
    logger,
    "[search-trending]"
  )
  res.setHeader(
    "Cache-Control",
    degraded ? "no-store" : "public, max-age=300"
  )
  res.json({ products: value })
}
