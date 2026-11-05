import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { SUPPLIER_MODULE } from "../../modules/supplier"
import SupplierModuleService from "../../modules/supplier/service"

export type UpdateSupplierStepInput = {
  id: string
  name?: string
  email?: string
  phone?: string
  address?: string
  notes?: string
}

export const updateSupplierStep = createStep(
  "update-supplier",
  async (input: UpdateSupplierStepInput, { container }) => {
    const supplierModule =
      container.resolve<SupplierModuleService>(SUPPLIER_MODULE)

    // A bad id throws NOT_FOUND here (404) before any write is attempted.
    const existing = await supplierModule.retrieveSupplier(input.id)

    const supplier = await supplierModule.updateSuppliers(input)

    return new StepResponse(supplier, {
      id: existing.id,
      name: existing.name,
      email: existing.email,
      phone: existing.phone,
      address: existing.address,
      notes: existing.notes,
    })
  },
  async (previous, { container }) => {
    if (!previous) {
      return
    }

    const supplierModule =
      container.resolve<SupplierModuleService>(SUPPLIER_MODULE)
    await supplierModule.updateSuppliers(previous)
  }
)
