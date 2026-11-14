import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { cancelOrderFulfillmentWorkflow } from "@medusajs/medusa/core-flows"

export type VoidableLabelState = { order_id: string; fulfillment_ids: string[] }
export type VoidedLabel = { fulfillment_id: string; refund_status: string | null }

// Reads the order and decides which label fulfillments can be voided. Rejects
// the whole request when any live fulfillment already shipped or was
// delivered, or when nothing is voidable. Fails closed when the fulfillments
// relation could not be read.
export const validateVoidOrderLabelStep = createStep(
  "validate-void-order-label",
  async (input: { order_id: string }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "fulfillments.id",
        "fulfillments.packed_at",
        "fulfillments.shipped_at",
        "fulfillments.delivered_at",
        "fulfillments.canceled_at",
        "fulfillments.data",
      ],
      filters: { id: input.order_id },
    })
    const order = data[0] as any
    if (!order) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${input.order_id} was not found`)
    }
    if (!Array.isArray(order.fulfillments)) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "The order's fulfillments could not be read, so its label cannot be voided"
      )
    }
    const live = order.fulfillments.filter((f: any) => !f?.canceled_at)
    if (live.some((f: any) => f.shipped_at || f.delivered_at)) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "This order has already shipped; a shipped label cannot be voided"
      )
    }
    const voidable = live.filter((f: any) => !!f?.data?.easypost_shipment_id)
    if (!voidable.length) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "There is no unshipped label to void")
    }
    return new StepResponse<VoidableLabelState>({
      order_id: order.id,
      fulfillment_ids: voidable.map((f: any) => f.id as string),
    })
  }
)

// Cancels each voidable fulfillment in turn; core's cancel workflow asks the
// EasyPost provider to refund the label and restores inventory. There is
// deliberately no compensation across fulfillments: a refund request cannot be
// undone, so if one fails we stop and the fulfillments already voided in this
// request stay voided.
// Core's cancelFulfillmentWorkflow discards the provider's refund result and
// does not persist it on the fulfillment, so refund_status is always null here.
export const voidOrderLabelFulfillmentsStep = createStep(
  "void-order-label-fulfillments",
  async (input: VoidableLabelState, { container }) => {
    const voided: VoidedLabel[] = []
    for (const fulfillmentId of input.fulfillment_ids) {
      try {
        await cancelOrderFulfillmentWorkflow(container).run({
          input: { order_id: input.order_id, fulfillment_id: fulfillmentId, no_notification: true },
        })
      } catch (e) {
        const message = e instanceof Error && e.message ? e.message : "unknown error"
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          `The carrier did not accept the label refund: ${message}`
        )
      }
      voided.push({ fulfillment_id: fulfillmentId, refund_status: null })
    }
    return new StepResponse(voided)
  }
)
