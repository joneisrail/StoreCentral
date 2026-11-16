import { model } from "@medusajs/framework/utils"

const ChannelStockMovement = model
  .define("channel_stock_movement", {
    id: model.id({ prefix: "chmov" }).primaryKey(),
    // "order" | "cancel" | "receipt" | "edit" | "rebalance" | "trim"
    kind: model.text(),
    variant_id: model.text(),
    sales_channel_id: model.text(),
    delta: model.number(),
    // order line id / receipt id / ...; null for kinds without a ref
    ref: model.text().nullable(),
  })
  .indexes([
    {
      name: "IDX_channel_stock_movement_kind_ref_variant_channel_unique",
      on: ["kind", "ref", "variant_id", "sales_channel_id"],
      unique: true,
    },
    {
      name: "IDX_channel_stock_movement_variant_id",
      on: ["variant_id"],
    },
  ])

export default ChannelStockMovement
