import { model } from "@medusajs/framework/utils"

const Review = model
  .define("review", {
    id: model.id().primaryKey(),
    product_id: model.text(),
    customer_id: model.text(),
    order_id: model.text().nullable(),
    rating: model.number(),
    title: model.text(),
    comment: model.text(),
    status: model.enum(["pending", "approved", "rejected"]).default("pending"),
  })
  .indexes([
    {
      name: "IDX_review_customer_id_product_id_unique",
      on: ["customer_id", "product_id"],
      unique: true,
      where: "deleted_at IS NULL",
    },
  ])

export default Review
