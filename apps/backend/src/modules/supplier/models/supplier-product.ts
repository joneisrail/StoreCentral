import { model } from "@medusajs/framework/utils"
import Supplier from "./supplier"

const SupplierProduct = model
  .define("supplier_product", {
    id: model.id().primaryKey(),
    supplier: model.belongsTo(() => Supplier, { mappedBy: "products" }),
    variant_id: model.text(),
    supplier_sku: model.text(),
    supplier_sku_key: model.text(),
    supplier_title: model.text().nullable(),
    unit_cost: model.bigNumber().nullable(),
    notes: model.text().nullable(),
  })
  .indexes([
    { on: ["supplier_id", "variant_id"], unique: true },
    { on: ["supplier_id", "supplier_sku_key"], unique: true },
  ])

export default SupplierProduct
