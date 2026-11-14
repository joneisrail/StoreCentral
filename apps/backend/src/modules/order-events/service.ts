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

  // Intentionally replaces the generated list method (filter/config signature)
  // with the order-scoped, newest-first variant the app uses.
  // @ts-expect-error incompatible override of the generated list method
  async listOrderEvents(
    orderId: string,
    limit = 200
  ): Promise<OrderEventRecord[]> {
    const rows = await this.baseList(
      { order_id: orderId },
      { take: limit, order: { created_at: "DESC", id: "DESC" } }
    )
    return rows as OrderEventRecord[]
  }

  private baseList(filters: unknown, config: unknown): Promise<any[]> {
    return (super.listOrderEvents as any).call(this, filters, config)
  }

  /**
   * Hard-deletes (not soft-deletes) events created before the cutoff.
   * Returns the number of rows removed.
   */
  async pruneOlderThan(cutoff: Date): Promise<number> {
    const stale = await this.baseList(
      { created_at: { $lt: cutoff } },
      { select: ["id"], withDeleted: true }
    )
    const ids = stale.map((e: { id: string }) => e.id)
    if (!ids.length) return 0
    await this.deleteOrderEvents(ids)
    return ids.length
  }
}

export default OrderEventsModuleService
