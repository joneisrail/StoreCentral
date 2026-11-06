import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { escapeLike } from "../../../../../modules/supplier/utils"
import { createSupplierProductWorkflow } from "../../../../../workflows/create-supplier-product"
import {
  mapSupplierProduct,
  retrieveAdminSupplierProduct,
  SUPPLIER_PRODUCT_FIELDS,
} from "../../map-supplier-product"
import type { SupplierProductRow } from "../../map-supplier-product"
import type {
  CreateSupplierProductSchema,
  ListSupplierProductsQuerySchema,
} from "../../middlewares"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const supplierId = req.params.id

  const { q, variant_id, limit, offset } =
    req.validatedQuery as unknown as ListSupplierProductsQuerySchema

  const { data: suppliers } = await query.graph({
    entity: "supplier",
    fields: ["id"],
    filters: { id: supplierId },
  })
  if (!suppliers.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Supplier with id: ${supplierId} was not found`
    )
  }

  const filters: Record<string, unknown> = { supplier_id: supplierId }
  if (variant_id) {
    filters.variant_id = variant_id
  }

  const term = q?.trim()
  if (term) {
    const pattern = `%${escapeLike(term)}%`

    // Our variant sku/title and product title live in the product module, so
    // match them there, limited to the variants on this supplier's list.
    const { data: listed } = await query.graph({
      entity: "supplier_product",
      fields: ["variant_id"],
      filters: { supplier_id: supplierId },
    })
    const listedVariantIds = [...new Set(listed.map((r) => r.variant_id))]

    let matchedVariantIds: string[] = []
    if (listedVariantIds.length) {
      const { data: variants } = await query.graph({
        entity: "product_variant",
        fields: ["id"],
        filters: {
          id: listedVariantIds,
          $or: [
            { sku: { $ilike: pattern } },
            { title: { $ilike: pattern } },
            { product: { title: { $ilike: pattern } } },
          ],
        },
      })
      matchedVariantIds = variants.map((v) => v.id)
    }

    filters.$or = [
      { supplier_sku: { $ilike: pattern } },
      { supplier_title: { $ilike: pattern } },
      ...(matchedVariantIds.length
        ? [{ variant_id: { $in: matchedVariantIds } }]
        : []),
    ]
  }

  const { data, metadata } = await query.graph({
    entity: "supplier_product",
    fields: SUPPLIER_PRODUCT_FIELDS,
    filters,
    pagination: { take: limit, skip: offset, order: { created_at: "DESC" } },
  })

  res.json({
    supplier_products: (data as unknown as SupplierProductRow[]).map(
      mapSupplierProduct
    ),
    count: metadata?.count ?? data.length,
    offset,
    limit,
  })
}

export async function POST(
  req: MedusaRequest<CreateSupplierProductSchema>,
  res: MedusaResponse
) {
  const { result } = await createSupplierProductWorkflow(req.scope).run({
    input: { ...req.validatedBody, supplier_id: req.params.id },
  })

  res.json({
    supplier_product: await retrieveAdminSupplierProduct(
      req.scope,
      result.supplier_product.id
    ),
  })
}
