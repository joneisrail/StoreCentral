import { defineLink } from "@medusajs/framework/utils"
import AccountingModule from "../modules/accounting"
import PurchaseModule from "../modules/purchase"

export default defineLink(
  { linkable: AccountingModule.linkable.invoice, isList: true },
  PurchaseModule.linkable.purchase
)
