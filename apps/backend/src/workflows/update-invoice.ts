import {
  createWorkflow,
  transform,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  rememberSupplierCodesStep,
  toRememberInput,
} from "./steps/remember-supplier-codes"
import {
  InvoiceLineInput,
  resolveInvoiceLinesStep,
} from "./steps/resolve-invoice-lines"
import { loadDraftInvoiceStep, updateInvoiceStep } from "./steps/update-invoice"

export type UpdateInvoiceWorkflowInput = {
  id: string
  invoice_number?: string
  invoice_date?: string
  due_date?: string | null
  shipping_cost?: number
  tax?: number
  other_cost?: number
  notes?: string | null
  // When given, replaces every line of the invoice.
  items?: InvoiceLineInput[]
}

export const updateInvoiceWorkflow = createWorkflow(
  "update-invoice",
  function (input: UpdateInvoiceWorkflowInput) {
    // 404 / locked fail here, before any code is remembered.
    const current = loadDraftInvoiceStep({ id: input.id })

    const resolved = when(
      "resolve-replacement-lines",
      { input },
      ({ input }) => !!input.items
    ).then(() => {
      const lines = resolveInvoiceLinesStep(
        transform({ input, current }, ({ input, current }) => ({
          purchase_id: current.purchase_id,
          items: input.items!,
        }))
      )

      // A later failure removes the entries again through this step's
      // compensation, as on create.
      rememberSupplierCodesStep(
        transform({ lines }, ({ lines }) => toRememberInput(lines))
      )

      return lines
    })

    const invoice = updateInvoiceStep(
      transform(
        { input, current, resolved },
        ({ input, current, resolved }) => ({
          id: current.id,
          supplier: current.supplier,
          invoice_number: input.invoice_number,
          invoice_date: input.invoice_date,
          due_date: input.due_date,
          shipping_cost: input.shipping_cost,
          tax: input.tax,
          other_cost: input.other_cost,
          notes: input.notes,
          items: resolved?.items,
        })
      )
    )

    return new WorkflowResponse({ invoice: { id: invoice.id } })
  }
)

export default updateInvoiceWorkflow
