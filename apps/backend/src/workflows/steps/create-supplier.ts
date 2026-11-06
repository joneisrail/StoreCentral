import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { SUPPLIER_MODULE } from "../../modules/supplier"
import SupplierModuleService from "../../modules/supplier/service"

export type CreateSupplierStepInput = {
  name: string
  email?: string
  phone?: string
  address?: string
  notes?: string
  contact_name?: string
  website?: string
  tax_id?: string
  payment_terms?: string
  lead_time_days?: number
  is_active?: boolean
}

export const createSupplierStep = createStep(
  "create-supplier",
  async (input: CreateSupplierStepInput, { container }) => {
    const supplierModule =
      container.resolve<SupplierModuleService>(SUPPLIER_MODULE)

    const supplier = await supplierModule.createSuppliers(input)

    return new StepResponse(supplier, supplier.id)
  },
  async (supplierId, { container }) => {
    if (!supplierId) {
      return
    }

    const supplierModule =
      container.resolve<SupplierModuleService>(SUPPLIER_MODULE)
    await supplierModule.deleteSuppliers(supplierId)
  }
)
