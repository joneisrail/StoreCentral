import { model } from "@medusajs/framework/utils"
import PurchaseItem from "./purchase-item"
import PurchaseReceipt from "./purchase-receipt"

const Purchase = model.define("purchase", {
  id: model.id().primaryKey(),
  display_id: model.autoincrement(),
  status: model
    .enum(["draft", "ordered", "partially_received", "received", "cancelled"])
    .default("draft"),
  currency_code: model.text().default("usd"),
  shipping_cost: model.bigNumber().default(0),
  tax: model.bigNumber().default(0),
  other_cost: model.bigNumber().default(0),
  notes: model.text().nullable(),
  ordered_at: model.dateTime().nullable(),
  items: model.hasMany(() => PurchaseItem, { mappedBy: "purchase" }),
  receipts: model.hasMany(() => PurchaseReceipt, { mappedBy: "purchase" }),
})

export default Purchase
