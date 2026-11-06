import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  updateSupplierProductStep,
  UpdateSupplierProductStepInput,
} from "./steps/update-supplier-product"

export const updateSupplierProductWorkflow = createWorkflow(
  "update-supplier-product",
  function (input: UpdateSupplierProductStepInput) {
    const supplierProduct = updateSupplierProductStep(input)

    return new WorkflowResponse({ supplier_product: supplierProduct })
  }
)

export default updateSupplierProductWorkflow
