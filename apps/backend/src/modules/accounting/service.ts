import { MedusaService } from "@medusajs/framework/utils"
import Invoice from "./models/invoice"
import InvoiceItem from "./models/invoice-item"

class AccountingModuleService extends MedusaService({
  Invoice,
  InvoiceItem,
}) {}

export default AccountingModuleService
