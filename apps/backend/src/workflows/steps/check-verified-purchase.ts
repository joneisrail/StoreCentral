import {
  createStep,
  StepResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"

type OrderWithItems = {
  id: string
  items: { product_id: string | null }[]
}

export function findQualifyingOrderId(
  orders: OrderWithItems[],
  productId: string
): string | null {
  const order = orders.find((o) =>
    o.items.some((item) => item.product_id === productId)
  )
  return order ? order.id : null
}

export const checkVerifiedPurchaseStep = createStep(
  "check-verified-purchase",
  async (
    input: { customerId: string; productId: string },
    { container }
  ) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "items.product_id"],
      filters: {
        customer_id: input.customerId,
        status: { $ne: "canceled" },
      },
    })

    const orderId = findQualifyingOrderId(
      orders.map((order) => ({
        id: order.id,
        items: (order.items ?? []).map((item) => ({
          product_id: item?.product_id ?? null,
        })),
      })),
      input.productId
    )

    if (!orderId) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "You can only review products you've purchased."
      )
    }

    return new StepResponse<string>(orderId)
  }
)
