import { defineLink } from "@medusajs/framework/utils"
import ProductModule from "@medusajs/medusa/product"
import PurchaseModule from "../modules/purchase"

export default defineLink(
  { linkable: PurchaseModule.linkable.purchaseItem, isList: true },
  ProductModule.linkable.productVariant
)
