import { Modules } from "@medusajs/framework/utils"
import type { LinkDefinition } from "@medusajs/framework/types"
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { dismissRemoteLinkStep } from "@medusajs/medusa/core-flows"
import { deleteSupplierProductsStep } from "./steps/delete-supplier-product"
import {
  deleteSupplierStep,
  DeleteSupplierStepInput,
  validateSupplierDeletionStep,
} from "./steps/delete-supplier"

// Product entries reference the supplier row, so they are unlinked from their
// variants and deleted first. Each step's compensation restores its part.
export const deleteSupplierWorkflow = createWorkflow(
  "delete-supplier",
  function (input: DeleteSupplierStepInput) {
    const entries = validateSupplierDeletionStep(input)

    dismissRemoteLinkStep(
      transform({ entries }, ({ entries }) =>
        entries.map(
          (entry): LinkDefinition => ({
            supplier: { supplier_product_id: entry.id },
            [Modules.PRODUCT]: { product_variant_id: entry.variant_id },
          })
        )
      )
    )
    deleteSupplierProductsStep(entries)

    const result = deleteSupplierStep(input)

    return new WorkflowResponse(result)
  }
)

export default deleteSupplierWorkflow
