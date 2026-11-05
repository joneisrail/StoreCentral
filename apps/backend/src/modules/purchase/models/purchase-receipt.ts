import { model } from "@medusajs/framework/utils"
import Purchase from "./purchase"
import PurchaseReceiptItem from "./purchase-receipt-item"

const PurchaseReceipt = model.define("purchase_receipt", {
  id: model.id().primaryKey(),
  purchase: model.belongsTo(() => Purchase, { mappedBy: "receipts" }),
  stock_location_id: model.text(),
  received_at: model.dateTime(),
  note: model.text().nullable(),
  items: model.hasMany(() => PurchaseReceiptItem, { mappedBy: "receipt" }),
})

export default PurchaseReceipt
