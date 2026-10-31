import { bulkFulfillOrdersWorkflow } from "@medusajs/core-flows"
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { AdminBulkFulfillOrdersType } from "../../validators"

export const POST = async (
  req: AuthenticatedMedusaRequest<AdminBulkFulfillOrdersType>,
  res: MedusaResponse<{
    succeeded: string[]
    failed: {
      order_id: string
      error: string
      easypost_shipment_id?: string
    }[]
    label_pdf_url?: string
  }>
) => {
  const { fulfillments } = req.validatedBody

  const { result } = await bulkFulfillOrdersWorkflow(req.scope).run({
    input: { fulfillments },
  })

  res.status(200).json(result)
}
