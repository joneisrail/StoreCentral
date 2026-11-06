import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { SUPPLIER_MODULE } from "../../modules/supplier"
import SupplierModuleService from "../../modules/supplier/service"
import { normalizeSupplierSku } from "../../modules/supplier/utils"
import {
  assertNoConflict,
  retrieveSupplierProductForSupplier,
  withConflictHandling,
} from "./supplier-product-helpers"

// The variant cannot be changed; unlink and add instead.
export type UpdateSupplierProductStepInput = {
  id: string
  supplier_id: string
  supplier_sku?: string
  supplier_title?: string | null
  unit_cost?: number | null
  notes?: string | null
}

export const updateSupplierProductStep = createStep(
  "update-supplier-product",
  async (input: UpdateSupplierProductStepInput, { container }) => {
    const supplierModule =
      container.resolve<SupplierModuleService>(SUPPLIER_MODULE)

    // 404 when the entry is missing or belongs to another supplier.
    const existing = await retrieveSupplierProductForSupplier(
      supplierModule,
      input.supplier_id,
      input.id
    )

    // Only the fields present in the body are written.
    const { supplier_id, supplier_sku, ...fields } = input
    const sku =
      supplier_sku === undefined ? undefined : normalizeSupplierSku(supplier_sku)

    const write = () =>
      supplierModule.updateSupplierProducts({ ...fields, ...sku })

    let supplierProduct: Awaited<ReturnType<typeof write>>
    if (sku) {
      const check = {
        supplier_id,
        exclude_id: existing.id,
        ...sku,
      }
      await assertNoConflict(supplierModule, check)
      supplierProduct = await withConflictHandling(supplierModule, check, write)
    } else {
      supplierProduct = await write()
    }

    return new StepResponse(supplierProduct, {
      id: existing.id,
      supplier_sku: existing.supplier_sku,
      supplier_sku_key: existing.supplier_sku_key,
      supplier_title: existing.supplier_title,
      unit_cost:
        existing.unit_cost === null ? null : Number(existing.unit_cost),
      notes: existing.notes,
    })
  },
  async (previous, { container }) => {
    if (!previous) {
      return
    }

    const supplierModule =
      container.resolve<SupplierModuleService>(SUPPLIER_MODULE)
    await supplierModule.updateSupplierProducts(previous)
  }
)
