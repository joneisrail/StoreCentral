import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { postInvoiceStep } from "./steps/post-invoice"

export type PostInvoiceWorkflowInput = { id: string }

export const postInvoiceWorkflow = createWorkflow(
  "post-invoice",
  function (input: PostInvoiceWorkflowInput) {
    const invoice = postInvoiceStep({ id: input.id })
    return new WorkflowResponse({ invoice })
  }
)

export default postInvoiceWorkflow
