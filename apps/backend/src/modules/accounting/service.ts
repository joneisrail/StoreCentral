import { MedusaService } from "@medusajs/framework/utils"
import Invoice from "./models/invoice"
import InvoiceItem from "./models/invoice-item"
import Expense from "./models/expense"
import Payment from "./models/payment"

class AccountingModuleService extends MedusaService({
  Invoice,
  InvoiceItem,
  Payment,
  Expense,
}) {}

export default AccountingModuleService
