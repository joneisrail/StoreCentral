import { defineLink } from "@medusajs/framework/utils"
import ReviewModule from "../modules/review"
import CustomerModule from "@medusajs/medusa/customer"

export default defineLink(
  { linkable: ReviewModule.linkable.review, isList: true },
  CustomerModule.linkable.customer
)
