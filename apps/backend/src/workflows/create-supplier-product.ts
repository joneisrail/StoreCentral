import { Modules } from "@medusajs/framework/utils"
import type { LinkDefinition } from "@medusajs/framework/types"
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { createRemoteLinkStep } from "@medusajs/medusa/core-flows"
import {
  createSupplierProductStep,
  CreateSupplierProductStepInput,
} from "./steps/create-supplier-product"

export const createSupplierProductWorkflow = createWorkflow(
  "create-supplier-product",
  function (input: CreateSupplierProductStepInput) {
    const supplierProduct = createSupplierProductStep(input)

    const links = transform({ supplierProduct }, ({ supplierProduct }) => {
      const definitions: LinkDefinition[] = [
        {
          supplier: { supplier_product_id: supplierProduct.id },
          [Modules.PRODUCT]: { product_variant_id: supplierProduct.variant_id },
        },
      ]
      return definitions
    })

    createRemoteLinkStep(links)

    return new WorkflowResponse({ supplier_product: supplierProduct })
  }
)

export default createSupplierProductWorkflow
