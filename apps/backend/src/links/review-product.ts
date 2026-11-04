import { defineLink } from "@medusajs/framework/utils"
import ReviewModule from "../modules/review"
import ProductModule from "@medusajs/medusa/product"

export default defineLink(
  { linkable: ReviewModule.linkable.review, isList: true },
  ProductModule.linkable.product
)
