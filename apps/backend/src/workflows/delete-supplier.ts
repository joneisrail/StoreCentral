import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  deleteSupplierStep,
  DeleteSupplierStepInput,
} from "./steps/delete-supplier"

export const deleteSupplierWorkflow = createWorkflow(
  "delete-supplier",
  function (input: DeleteSupplierStepInput) {
    const result = deleteSupplierStep(input)

    return new WorkflowResponse(result)
  }
)

export default deleteSupplierWorkflow
