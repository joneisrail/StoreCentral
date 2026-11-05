import { model } from "@medusajs/framework/utils"
import Purchase from "./purchase"

const PurchaseItem = model.define("purchase_item", {
  id: model.id().primaryKey(),
  purchase: model.belongsTo(() => Purchase, { mappedBy: "items" }),
  variant_id: model.text(),
  sku: model.text(),
  title: model.text(),
  quantity: model.number(),
  quantity_received: model.number().default(0),
  unit_cost: model.bigNumber(),
})

export default PurchaseItem
