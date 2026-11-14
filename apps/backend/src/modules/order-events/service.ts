import { MedusaService } from "@medusajs/framework/utils"
import OrderEvent from "./models/order-event"

export type OrderEventType =
  | "order.held"
  | "order.released"
  | "order.label_voided"
  | "order.marked_shipped"
  | "order.canceled"
  | "order.shipped"
  | "order.delivered"

export type OrderEventRecord = {
  id: string
  order_id: string
  type: string
  actor: string
  old_value: unknown | null
  new_value: unknown | null
  created_at: Date | string
}

export type RecordOrderEventInput = {
  order_id: string
  type: OrderEventType
  actor: string
  old_value?: unknown
  new_value?: unknown
}

class OrderEventsModuleService extends MedusaService({
  OrderEvent,
}) {
  async recordOrderEvent(input: RecordOrderEventInput): Promise<void> {
    await this.createOrderEvents({
      order_id: input.order_id,
      type: input.type,
      actor: input.actor,
      old_value: (input.old_value ?? null) as any,
      new_value: (input.new_value ?? null) as any,
    })
  }

  async listForOrder(
    orderId: string,
    limit = 200
  ): Promise<OrderEventRecord[]> {
    const rows = await this.listOrderEvents(
      { order_id: orderId },
      { order: { created_at: "DESC", id: "DESC" }, take: limit }
    )
    return rows as unknown as OrderEventRecord[]
  }

  /**
   * Hard-deletes (not soft-deletes) events created before the cutoff, in
   * batches. Returns the total number of rows removed.
   */
  async pruneOlderThan(cutoff: Date, batchSize = 1000): Promise<number> {
    let total = 0
    for (;;) {
      const stale = await this.listOrderEvents(
        { created_at: { $lt: cutoff } },
        { select: ["id"], take: batchSize, withDeleted: true }
      )
      if (!stale.length) return total
      await this.deleteOrderEvents(stale.map((e) => e.id))
      total += stale.length
    }
  }
}

export default OrderEventsModuleService
