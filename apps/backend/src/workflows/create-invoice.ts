import { Modules } from "@medusajs/framework/utils"
import type { LinkDefinition } from "@medusajs/framework/types"
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { createRemoteLinkStep } from "@medusajs/medusa/core-flows"
import { createInvoiceStep } from "./steps/create-invoice"
import {
  rememberSupplierCodesStep,
  toRememberInput,
} from "./steps/remember-supplier-codes"
import {
  InvoiceLineInput,
  resolveInvoiceLinesStep,
} from "./steps/resolve-invoice-lines"

export type CreateInvoiceWorkflowInput = {
  purchase_id: string
  invoice_number: string
  invoice_date: string
  due_date?: string
  shipping_cost?: number
  tax?: number
  other_cost?: number
  notes?: string
  items: InvoiceLineInput[]
}

export const createInvoiceWorkflow = createWorkflow(
  "create-invoice",
  function (input: CreateInvoiceWorkflowInput) {
    const resolved = resolveInvoiceLinesStep({
      purchase_id: input.purchase_id,
      items: input.items,
    })

    // Runs before the invoice is created; a later failure removes the
    // entries again through this step's compensation.
    rememberSupplierCodesStep(
      transform({ resolved }, ({ resolved }) => toRememberInput(resolved))
    )

    const invoice = createInvoiceStep(
      transform({ input, resolved }, ({ input, resolved }) => ({
        supplier: resolved.supplier,
        purchase_id: resolved.purchase.id,
        invoice_number: input.invoice_number,
        invoice_date: input.invoice_date,
        due_date: input.due_date,
        shipping_cost: input.shipping_cost,
        tax: input.tax,
        other_cost: input.other_cost,
        notes: input.notes,
        items: resolved.items,
      }))
    )

    const links = transform({ invoice, resolved }, ({ invoice, resolved }) => {
      const definitions: LinkDefinition[] = [
        {
          accounting: { invoice_id: invoice.id },
          purchase: { purchase_id: resolved.purchase.id },
        },
        ...invoice.items.map((item): LinkDefinition => ({
          accounting: { invoice_item_id: item.id },
          [Modules.PRODUCT]: { product_variant_id: item.variant_id },
        })),
      ]
      return definitions
    })

    createRemoteLinkStep(links)

    return new WorkflowResponse({ invoice })
  }
)

export default createInvoiceWorkflow
