import { MedusaService } from "@medusajs/framework/utils"
import Purchase from "./models/purchase"
import PurchaseItem from "./models/purchase-item"
import PurchaseReceipt from "./models/purchase-receipt"
import PurchaseReceiptItem from "./models/purchase-receipt-item"

class PurchaseModuleService extends MedusaService({
  Purchase,
  PurchaseItem,
  PurchaseReceipt,
  PurchaseReceiptItem,
}) {}

export default PurchaseModuleService
