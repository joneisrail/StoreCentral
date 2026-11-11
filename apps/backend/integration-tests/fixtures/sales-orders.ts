import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export type OrderOpts = {
  at?: string
  currency?: string
  status?: string
  canceled?: boolean
  items?: {
    title: string
    quantity: number
    unit_price: number
    variant_id?: string
    tax?: number
  }[]
  shipping?: number
}

// Dated orders and refunds for the accounting report specs. Orders are
// created straight through the order module (the order seeder cannot make a
// second order on its fixture SKU), then dated with parameterized SQL.
export function createSalesOrderHelpers(getContainer: () => MedusaContainer) {
  const sql = () =>
    getContainer().resolve(ContainerRegistrationKeys.PG_CONNECTION)
  // The order module's service type is not exported with these methods.
  const orderModule = () => getContainer().resolve(Modules.ORDER) as any

  const makeOrder = async (o: OrderOpts = {}) => {
    const order = await orderModule().createOrders({
      currency_code: o.currency ?? "usd",
      email: "buyer@example.com",
      status: o.status ?? "pending",
      items: (o.items ?? [{ title: "Widget", quantity: 1, unit_price: 100 }]).map(
        (i) => ({
          title: i.title,
          quantity: i.quantity,
          unit_price: i.unit_price,
          variant_id: i.variant_id,
          tax_lines: i.tax
            ? [{ description: "tax", code: "t", rate: i.tax, provider_id: "system" }]
            : [],
        })
      ),
      shipping_methods:
        o.shipping === undefined ? [] : [{ name: "Ship", amount: o.shipping }],
    })
    if (o.at) {
      await sql().raw('update "order" set created_at = ? where id = ?', [
        o.at,
        order.id,
      ])
    }
    if (o.canceled) {
      await sql().raw(
        `update "order" set status = 'canceled', canceled_at = now() where id = ?`,
        [order.id]
      )
    }
    return order as { id: string }
  }

  const refund = async (
    orderId: string,
    amount: number,
    at?: string,
    currency = "usd"
  ) => {
    const [tx] = await orderModule().addOrderTransactions([
      {
        order_id: orderId,
        amount: -amount,
        currency_code: currency,
        reference: "refund",
        reference_id: `ref_${Math.random()}`,
      },
    ])
    if (at) {
      await sql().raw(
        "update order_transaction set created_at = ? where id = ?",
        [at, tx.id]
      )
    }
  }

  return { sql, makeOrder, refund }
}
