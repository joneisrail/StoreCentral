import { defineLink } from "@medusajs/framework/utils"
import StockLocationModule from "@medusajs/medusa/stock-location"
import PurchaseModule from "../modules/purchase"

export default defineLink(
  { linkable: PurchaseModule.linkable.purchaseReceipt, isList: true },
  StockLocationModule.linkable.stockLocation
)
