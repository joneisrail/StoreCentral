import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import recordSearchQueryWorkflow from "../../../../workflows/record-search-query"
import {
  createRecordEventHandler,
  defaultLimiter,
} from "../../../../modules/search-insights/record-event"

// Public (no auth). The limiter is per process: with several backend
// instances each enforces its own 30 events/minute/IP budget.
const handler = createRecordEventHandler({
  limiter: defaultLimiter(),
  record: (req, input) =>
    recordSearchQueryWorkflow(req.scope).run({ input }),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  return handler(req, res)
}
