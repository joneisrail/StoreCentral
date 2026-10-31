import {
  WorkflowData,
  WorkflowResponse,
  createWorkflow,
} from "@medusajs/framework/workflows-sdk"
import { BulkFulfillOrdersStepInput, bulkFulfillOrdersStep } from "../steps"

export const bulkFulfillOrdersWorkflowId = "bulk-fulfill-orders"
/**
 * This workflow fulfills one or more orders in a single call, used by the
 * Bulk Fulfill Orders Admin API Route. Unlike an all-or-nothing bulk
 * workflow, each order's fulfillment attempt is independent: one order's
 * failure never blocks or rolls back the others. The result reports which
 * orders succeeded and, for the ones that didn't, the error message for
 * each.
 *
 * Each order is fulfilled with only its own remaining unfulfilled items, so
 * an order that's already partially fulfilled only has its remaining items
 * fulfilled.
 *
 * You can also use this workflow within your own custom workflows, allowing
 * you to wrap custom logic around bulk order fulfillment.
 *
 * @example
 * const { result } = await bulkFulfillOrdersWorkflow(container)
 * .run({
 *   input: {
 *     fulfillments: [
 *       { order_id: "order_123", shipment_id: "shp_123", rate_id: "rate_123" },
 *       { order_id: "order_456", shipment_id: "shp_456", rate_id: "rate_456" },
 *     ]
 *   }
 * })
 *
 * @summary
 *
 * Fulfill one or more orders, independently of each other.
 */
export const bulkFulfillOrdersWorkflow = createWorkflow(
  bulkFulfillOrdersWorkflowId,
  (input: WorkflowData<BulkFulfillOrdersStepInput>) => {
    const result = bulkFulfillOrdersStep(input)

    return new WorkflowResponse(result)
  }
)
