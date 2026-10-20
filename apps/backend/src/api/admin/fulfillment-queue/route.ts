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
          // getLastFulfillmentStatus never looks at order.status, so a
          // canceled order with zero fulfillments reports
          // "not_fulfilled" and must be excluded here, not left to
          // buildQueuePage (final-review Critical finding).
          status: { $nin: ["canceled", "archived", "draft"] },
          created_at: { $gte: windowStart },
        },
        // DESC + take keeps the MOST RECENT orders in the window, not
        // the oldest (final-review Important finding: ASC + take 500
        // kept the 500 *oldest* orders in the window, so once a store
        // passes 500 orders in 90 days, new orders would never appear
        // until old ones aged out). buildQueuePage re-sorts ascending
        // for display once the window is fetched.
        order: { created_at: "DESC" },
        take: MAX_WINDOW_ORDERS,
      },
    },
  })

  const orders = (
    Array.isArray(result) ? result : result.rows
  ) as OrderWithSalesChannel[]

  const page = buildQueuePage(orders, { offset, limit })

  res.json({
    ...page,
    offset,
    limit,
    // Signals to the caller that the 90-day window was cut off by the
    // order cap rather than genuinely exhausted -- without this, a
    // truncated fetch looks identical to "that's really all of them".
    truncated: orders.length === MAX_WINDOW_ORDERS,
  })
}
