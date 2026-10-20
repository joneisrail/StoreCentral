import { getOrdersListWorkflow } from "@medusajs/medusa/core-flows"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildQueuePage, type OrderWithSalesChannel } from "./build-queue-page"

const WINDOW_DAYS = 90
const MAX_WINDOW_ORDERS = 500
const DEFAULT_LIMIT = 20

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const offset = Number(req.query.offset ?? 0)
  const limit = Number(req.query.limit ?? DEFAULT_LIMIT)

  const windowStart = new Date(
    Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()

  const { result } = await getOrdersListWorkflow(req.scope).run({
    input: {
      fields: [
        "display_id",
        "created_at",
        "email",
        "total",
        "currency_code",
        "sales_channel.id",
        "sales_channel.name",
      ],
      variables: {
        filters: {
          is_draft_order: false,
          created_at: { $gte: windowStart },
        },
        order: { created_at: "ASC" },
        take: MAX_WINDOW_ORDERS,
      },
    },
  })

  const orders = (
    Array.isArray(result) ? result : result.rows
  ) as OrderWithSalesChannel[]

  const page = buildQueuePage(orders, { offset, limit })

  res.json({ ...page, offset, limit })
}
