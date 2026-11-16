import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CHANNEL_OFFERS_MODULE } from "../../../modules/channel-offers"
import { callSellerHub } from "../marketplace-connections/seller-hub-client"
import type { ChannelOffersGridQuery } from "./middlewares"
import { loadGrid } from "./query"

const HUB_TIMEOUT_MS = 4000

// Sales channels with a seller-hub connection. Any failure (not configured,
// unreachable, rejected secret, non-200, odd body) means "none": the grid still
// answers. Nothing is logged: errors from the client carry fixed messages only.
async function connectedChannelIds(): Promise<Set<string>> {
  try {
    const { status, body } = await callSellerHub("GET", "/internal/connections", undefined, {
      timeoutMs: HUB_TIMEOUT_MS,
    })
    if (status !== 200 || !Array.isArray(body?.connections)) return new Set()
    return new Set(
      body.connections
        .filter((c: any) => c && typeof c.sales_channel_id === "string" && c.status !== "disconnected")
        .map((c: any) => c.sales_channel_id as string)
    )
  } catch {
    return new Set()
  }
}

// Bulk stock read for the grid sort keys. Raw read-only SQL on purpose: the
// graph/module readers cost ~0.25ms per row here (about 2s for 5,000 variants)
// while this aggregate takes ~0.1s. It touches the inventory module's
// `inventory_level` and the product<->inventory link table, soft deletes
// respected; the net-stock math itself stays in availableFromItems.
const STOCK_ROWS_SQL = `
  select l.variant_id, l.required_quantity,
         coalesce(sum(il.stocked_quantity - il.reserved_quantity), 0) as net
  from product_variant_inventory_item l
  left join inventory_level il
    on il.inventory_item_id = l.inventory_item_id and il.deleted_at is null
  where l.deleted_at is null
  group by l.variant_id, l.inventory_item_id, l.required_quantity`

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const params = req.validatedQuery as unknown as ChannelOffersGridQuery
  const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any
  const result = await loadGrid(
    {
      query: req.scope.resolve(ContainerRegistrationKeys.QUERY) as any,
      offers: req.scope.resolve(CHANNEL_OFFERS_MODULE) as any,
      stockRows: async () => (await pg.raw(STOCK_ROWS_SQL)).rows,
      connectedChannelIds,
    },
    params
  )
  res.json(result)
}
