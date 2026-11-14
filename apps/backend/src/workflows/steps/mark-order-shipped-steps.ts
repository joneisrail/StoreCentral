import { ContainerRegistrationKeys, MathBN, MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import {
  cancelOrderFulfillmentWorkflow,
  createOrderFulfillmentWorkflow,
  createOrderShipmentWorkflow,
} from "@medusajs/medusa/core-flows"
import { deriveFulfillmentStatus, HOLD_TAG_VALUE } from "./hold-order-steps"

// The system manual fulfillment provider. A hand-shipped order has no carrier
// integration, so the fulfillment is always created through it, whatever
// provider the order's own shipping method belongs to.
export const MANUAL_PROVIDER_ID = "manual_manual"

export type ShipItem = { id: string; quantity: number }
export type MarkShippedState = { order_id: string; items: ShipItem[] }
export type MarkShippedPlacement = { location_id: string; shipping_option_id: string }

const notAllowed = (message: string) => new MedusaError(MedusaError.Types.NOT_ALLOWED, message)

// Reads the order and rejects every state that cannot be marked shipped. Fails
// closed when the fulfillments relation could not be read. Messages never
// include request data such as tracking numbers.
export const validateMarkOrderShippedStep = createStep(
  "validate-mark-order-shipped",
  async (input: { order_id: string }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "status",
        "tags.id",
        "tags.value",
        "items.id",
        "items.quantity",
        "items.detail.fulfilled_quantity",
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
    if (order.status === "canceled") {
      throw notAllowed("A canceled order cannot be marked shipped")
    }
    if ((order.tags ?? []).some((t: any) => t?.value === HOLD_TAG_VALUE)) {
      throw notAllowed("The order is on hold; release it before marking it shipped")
    }
    if (!Array.isArray(order.fulfillments)) {
      throw notAllowed("The order's fulfillments could not be read, so it cannot be marked shipped")
    }
    if (["shipped", "delivered"].includes(deriveFulfillmentStatus(order.fulfillments))) {
      throw notAllowed("This order has already shipped")
    }
    if (order.fulfillments.some((f: any) => !f?.canceled_at && f?.data?.easypost_shipment_id)) {
      throw notAllowed("Void the shipping label first")
    }
    const items: ShipItem[] = (order.items ?? [])
      .map((item: any) => ({
        id: item.id as string,
        remaining: MathBN.sub(item.quantity, item.detail?.fulfilled_quantity ?? 0),
      }))
      .filter(({ remaining }: any) => MathBN.gt(remaining, 0))
      .map(({ id, remaining }: any) => ({ id, quantity: Number(remaining) }))
    if (!items.length) {
      throw notAllowed("The order has no unfulfilled items to ship")
    }
    return new StepResponse<MarkShippedState>({ order_id: order.id, items })
  }
)

const locationOf = (option: any): string | undefined => option?.service_zone?.fulfillment_set?.location?.id

// Decides where the fulfillment is created. Shipping option: the order's own
// shipping method when it has one (its profile matches the items by
// construction), otherwise a manual-provider option, because core cannot
// create a fulfillment without one (imported orders have no shipping method).
// Location: the request, else Settings > Fulfillment default ship-from, else
// the option's stock location.
export const resolveMarkShippedPlacementStep = createStep(
  "resolve-mark-shipped-placement",
  async (input: { order_id: string; location_id?: string }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const fields = ["id", "service_zone.fulfillment_set.location.id"]

    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "shipping_methods.shipping_option_id"],
      filters: { id: input.order_id },
    })
    const methodOptionId = (orders[0] as any)?.shipping_methods?.[0]?.shipping_option_id as string | undefined

    const { data: stores } = await query.graph({ entity: "store", fields: ["id", "metadata"] })
    const storeDefault = (stores[0] as any)?.metadata?.default_ship_from_location_id
    const requested =
      input.location_id ?? (typeof storeDefault === "string" && storeDefault ? storeDefault : undefined)

    let option: any
    if (methodOptionId) {
      const { data } = await query.graph({ entity: "shipping_option", fields, filters: { id: methodOptionId } })
      option = data[0]
    }
    if (!option) {
      const { data } = await query.graph({
        entity: "shipping_option",
        fields,
        filters: { provider_id: MANUAL_PROVIDER_ID },
      })
      const manual = data as any[]
      option = (requested && manual.find((o) => locationOf(o) === requested)) || manual[0]
    }
    if (!option) {
      throw notAllowed(
        "No shipping option is available to record this shipment; create a manual shipping option in Settings > Locations & Shipping"
      )
    }
    const location_id = requested ?? locationOf(option)
    if (!location_id) {
      throw notAllowed(
        "No Ship From location is set; choose one in Settings > Fulfillment or pass a location"
      )
    }
    return new StepResponse<MarkShippedPlacement>({ location_id, shipping_option_id: option.id })
  }
)

export type MarkShippedStepInput = {
  order_id: string
  items: ShipItem[]
  location_id: string
  shipping_option_id: string
  carrier: string
  tracking_number: string
  tracking_url?: string
  shipped_at?: string
  no_notification?: boolean
  user_id?: string
}

// Creates the fulfillment for every unfulfilled item and immediately ships it.
// The loop-free but dynamic input handling lives here, outside the composition
// function. If the shipment fails after the fulfillment exists, the
// fulfillment is canceled (restoring reservations/inventory) and the original
// error is rethrown. Never logs tracking data.
// `shipped_at` is recorded only in the fulfillment metadata; core stamps the
// real shipped_at itself.
export const markOrderShippedStep = createStep(
  "mark-order-shipped",
  async (input: MarkShippedStepInput, { container }) => {
    const metadata: Record<string, unknown> = { carrier: input.carrier }
    if (input.shipped_at) metadata.shipped_at = input.shipped_at

    const { result: fulfillment } = await createOrderFulfillmentWorkflow(container).run({
      input: {
        order_id: input.order_id,
        items: input.items,
        location_id: input.location_id,
        shipping_option_id: input.shipping_option_id,
        provider_id: MANUAL_PROVIDER_ID,
        provider_data_override: { carrier: input.carrier },
        metadata,
        no_notification: input.no_notification,
        created_by: input.user_id,
      },
    })

    try {
      await createOrderShipmentWorkflow(container).run({
        input: {
          order_id: input.order_id,
          fulfillment_id: fulfillment.id,
          items: input.items,
          labels: [
            {
              tracking_number: input.tracking_number,
              tracking_url: input.tracking_url ?? "",
              label_url: "",
            },
          ],
          no_notification: input.no_notification,
          created_by: input.user_id,
        },
      })
    } catch (e) {
      try {
        await cancelOrderFulfillmentWorkflow(container).run({
          input: { order_id: input.order_id, fulfillment_id: fulfillment.id, no_notification: true },
        })
      } catch {
        // Best effort: the original failure is the one worth reporting.
      }
      throw e
    }
    return new StepResponse({ order_id: input.order_id, fulfillment_id: fulfillment.id as string })
  }
)
