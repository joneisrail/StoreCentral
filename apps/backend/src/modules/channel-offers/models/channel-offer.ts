import { model } from "@medusajs/framework/utils"

const ChannelOffer = model
  .define("channel_offer", {
    id: model.id({ prefix: "choff" }).primaryKey(),
    variant_id: model.text(),
    sales_channel_id: model.text(),
    // null = use the variant's base price
    price: model.bigNumber().nullable(),
    stock: model.number().default(0),
    last_synced_price: model.bigNumber().nullable(),
    last_synced_stock: model.number().nullable(),
    last_synced_at: model.dateTime().nullable(),
    // "synced" | "pending" | "failed"
    sync_state: model.text().default("pending"),
    last_error: model.text().nullable(),
    // Ascending int assigned when the channel first gets an offer row.
    channel_order: model.number().default(0),
  })
  .indexes([
    {
      name: "IDX_channel_offer_variant_channel_unique",
      on: ["variant_id", "sales_channel_id"],
      unique: true,
    },
    {
      name: "IDX_channel_offer_sales_channel_id",
      on: ["sales_channel_id"],
    },
  ])

export default ChannelOffer
