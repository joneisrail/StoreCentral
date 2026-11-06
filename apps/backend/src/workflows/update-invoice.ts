import { Modules } from "@medusajs/framework/utils"
import type { LinkDefinition } from "@medusajs/framework/types"
import {
  createWorkflow,
  transform,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  createRemoteLinkStep,
  dismissRemoteLinkStep,
} from "@medusajs/medusa/core-flows"
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
  due_date?: string
  shipping_cost?: number
  tax?: number
  other_cost?: number
  notes?: string
  // When given, replaces every line of the invoice.
  items?: InvoiceLineInput[]
}

const itemLink = (item: {
  id: string
  variant_id: string
}): LinkDefinition => ({
  accounting: { invoice_item_id: item.id },
  [Modules.PRODUCT]: { product_variant_id: item.variant_id },
})

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

    when("relink-replaced-lines", { input }, ({ input }) => !!input.items).then(
      () => {
        dismissRemoteLinkStep(
          transform({ invoice }, ({ invoice }) =>
            invoice.replaced_items.map(itemLink)
          )
        )

        // One link module, so the insert is all or nothing; if it fails, the
        // compensations restore the dismissed links and the old lines.
        createRemoteLinkStep(
          transform({ invoice }, ({ invoice }) =>
            (invoice.items ?? []).map(itemLink)
          )
        )
      }
    )

    return new WorkflowResponse({ invoice: { id: invoice.id } })
  }
)

export default updateInvoiceWorkflow
