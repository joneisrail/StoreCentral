import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { voidInvoiceStep } from "./steps/void-invoice"

export type VoidInvoiceWorkflowInput = { id: string }

export const voidInvoiceWorkflow = createWorkflow(
  "void-invoice",
  function (input: VoidInvoiceWorkflowInput) {
    const invoice = voidInvoiceStep({ id: input.id })
    return new WorkflowResponse({ invoice })
  }
)

export default voidInvoiceWorkflow
