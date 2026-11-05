import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { SUPPLIER_MODULE } from "../../modules/supplier"
import SupplierModuleService from "../../modules/supplier/service"

export type DeleteSupplierStepInput = {
  id: string
}

export const deleteSupplierStep = createStep(
  "delete-supplier",
  async (input: DeleteSupplierStepInput, { container }) => {
    const supplierModule =
      container.resolve<SupplierModuleService>(SUPPLIER_MODULE)
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    // A bad id throws NOT_FOUND here (404).
    const existing = await supplierModule.retrieveSupplier(input.id)

    const { data } = await query.graph({
      entity: "supplier",
      fields: ["id", "purchases.id"],
      filters: { id: input.id },
    })
    if (data[0]?.purchases?.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Supplier has purchases and cannot be deleted"
      )
    }

    await supplierModule.deleteSuppliers(input.id)

    return new StepResponse(
      { id: input.id },
      {
        id: existing.id,
        name: existing.name,
        email: existing.email,
        phone: existing.phone,
        address: existing.address,
        notes: existing.notes,
      }
    )
  },
  async (previous, { container }) => {
    if (!previous) {
      return
    }

    const supplierModule =
      container.resolve<SupplierModuleService>(SUPPLIER_MODULE)
    await supplierModule.createSuppliers(previous)
  }
)
