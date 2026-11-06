import { Modules } from "@medusajs/framework/utils"
import type { LinkDefinition } from "@medusajs/framework/types"
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { dismissRemoteLinkStep } from "@medusajs/medusa/core-flows"
import {
  deleteSupplierProductsStep,
  DeleteSupplierProductStepInput,
  retrieveSupplierProductStep,
} from "./steps/delete-supplier-product"

export const deleteSupplierProductWorkflow = createWorkflow(
  "delete-supplier-product",
  function (input: DeleteSupplierProductStepInput) {
    const snapshot = retrieveSupplierProductStep(input)

    const links = transform({ snapshot }, ({ snapshot }): LinkDefinition[] => [
      {
        supplier: { supplier_product_id: snapshot.id },
        [Modules.PRODUCT]: { product_variant_id: snapshot.variant_id },
      },
    ])

    dismissRemoteLinkStep(links)
    deleteSupplierProductsStep(
      transform({ snapshot }, ({ snapshot }) => [snapshot])
    )

    return new WorkflowResponse(
      transform({ snapshot }, ({ snapshot }) => ({ id: snapshot.id }))
    )
  }
)

export default deleteSupplierProductWorkflow
