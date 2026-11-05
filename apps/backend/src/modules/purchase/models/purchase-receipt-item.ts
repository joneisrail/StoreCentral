import { model } from "@medusajs/framework/utils"
import PurchaseReceipt from "./purchase-receipt"

const PurchaseReceiptItem = model.define("purchase_receipt_item", {
  id: model.id().primaryKey(),
  receipt: model.belongsTo(() => PurchaseReceipt, { mappedBy: "items" }),
  purchase_item_id: model.text(),
  quantity: model.number(),
})

export default PurchaseReceiptItem
