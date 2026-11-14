import { model } from "@medusajs/framework/utils"

const OrderEvent = model
  .define("order_event", {
    id: model.id({ prefix: "oevt" }).primaryKey(),
    order_id: model.text(),
    type: model.text(),
    actor: model.text(),
    old_value: model.json().nullable(),
    new_value: model.json().nullable(),
  })
  .indexes([
    {
      name: "IDX_order_event_order_id_created_at",
      on: ["order_id", "created_at"],
    },
  ])

export default OrderEvent
