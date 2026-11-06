import { defineLink } from "@medusajs/framework/utils"
import ProductModule from "@medusajs/medusa/product"
import AccountingModule from "../modules/accounting"

export default defineLink(
  { linkable: AccountingModule.linkable.invoiceItem, isList: true },
  ProductModule.linkable.productVariant
)
