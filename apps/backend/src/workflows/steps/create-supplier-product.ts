import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { SUPPLIER_MODULE } from "../../modules/supplier"
import SupplierModuleService from "../../modules/supplier/service"
import { normalizeSupplierSku } from "../../modules/supplier/utils"
import { assertNoConflict, withConflictHandling } from "./supplier-product-helpers"

export type CreateSupplierProductStepInput = {
  supplier_id: string
  variant_id: string
  supplier_sku: string
  supplier_title?: string
  unit_cost?: number
  notes?: string
}

export const createSupplierProductStep = createStep(
  "create-supplier-product",
  async (input: CreateSupplierProductStepInput, { container }) => {
    const supplierModule =
      container.resolve<SupplierModuleService>(SUPPLIER_MODULE)
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    // A bad supplier id throws NOT_FOUND here (404). Inactive suppliers may
    // still maintain their list.
    await supplierModule.retrieveSupplier(input.supplier_id)

    const { data: variants } = await query.graph({
      entity: "product_variant",
      fields: ["id"],
      filters: { id: input.variant_id },
    })
    if (!variants.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Product variant with id: ${input.variant_id} was not found`
      )
    }

    const sku = normalizeSupplierSku(input.supplier_sku)
    const check = {
      supplier_id: input.supplier_id,
      variant_id: input.variant_id,
      ...sku,
    }
    await assertNoConflict(supplierModule, check)

    const supplierProduct = await withConflictHandling(
      supplierModule,
      check,
      () =>
        supplierModule.createSupplierProducts({
          supplier_id: input.supplier_id,
          variant_id: input.variant_id,
          ...sku,
          supplier_title: input.supplier_title,
          unit_cost: input.unit_cost,
          notes: input.notes,
        })
    )

    return new StepResponse(supplierProduct, supplierProduct.id)
  },
  async (supplierProductId, { container }) => {
    if (!supplierProductId) {
      return
    }

    const supplierModule =
      container.resolve<SupplierModuleService>(SUPPLIER_MODULE)
    await supplierModule.deleteSupplierProducts(supplierProductId)
  }
)
