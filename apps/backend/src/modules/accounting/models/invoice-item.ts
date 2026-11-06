import { model } from "@medusajs/framework/utils"
import Invoice from "./invoice"

const InvoiceItem = model.define("invoice_item", {
  id: model.id().primaryKey(),
  invoice: model.belongsTo(() => Invoice, { mappedBy: "items" }),
  purchase_item_id: model.text().nullable(),
  variant_id: model.text(),
  supplier_sku: model.text(),
  description: model.text(),
  quantity: model.number(),
  unit_cost: model.bigNumber(),
})

export default InvoiceItem
