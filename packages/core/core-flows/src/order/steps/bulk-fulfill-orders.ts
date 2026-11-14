import { BigNumberInput, Logger } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MathBN,
  MedusaError,
} from "@medusajs/framework/utils"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { createOrderFulfillmentWorkflow } from "../workflows/create-fulfillment"
import {
  EASYPOST_FULFILLMENT_PROVIDER_ID,
  resolveEasyPostFulfillmentProvider,
} from "../utils/resolve-easypost-provider"

// This step talks to the EasyPost fulfillment provider's service directly
// (resolved through the Fulfillment Module's provider registry by
// `resolveEasyPostFulfillmentProvider` - providers live in that module's own
// isolated container, not the app container, see that helper's comment)
// rather than going through a provider-agnostic abstraction. That's a
// deliberate, narrow scope: the admin "Ready to Ship" bulk-fulfillment tool
// this step backs only ever quotes and buys rates through EasyPost, matching
// the same pragmatic, EasyPost-specific pattern already used elsewhere in
// this codebase (for example the EasyPost webhook route at
// apps/backend/src/api/webhooks/easypost/route.ts). This type intentionally
// mirrors just the two methods this step calls on
// `EasyPostFulfillmentService` (packages/modules/providers/fulfillment-easypost)
// rather than importing that package, which core-flows does not depend on.
type EasyPostFulfillmentProviderService = {
  buyRate: (
    shipmentId: string,
    rateId: string
  ) => Promise<{
    id: string
    trackingCode?: string
    labelUrl?: string
    trackerId?: string
  }>
  createLabelBatch: (
    shipmentIds: string[],
    format: string
  ) => Promise<{ labelUrl?: string }>
}

/**
 * The data to bulk fulfill one or more orders.
 */
export type BulkFulfillOrdersStepInput = {
  /**
   * The orders to fulfill, each with the EasyPost shipment/rate the admin
   * already quoted and picked client-side.
   */
  fulfillments: {
    /**
     * The ID of the order to fulfill.
     */
    order_id: string
    /**
     * The ID of the stock location to fulfill the order's items from.
     */
    location_id?: string
    /**
     * The ID of the EasyPost shipment that was quoted for this order.
     */
    shipment_id: string
    /**
     * The ID of the EasyPost rate, from that shipment's quoted rates, to
     * buy for this order.
     */
    rate_id: string
    /**
     * Whether to skip the fulfillment-created notification for this order.
     */
    no_notification?: boolean
  }[]
}

/**
 * The outcome of a bulk fulfillment attempt, reported per order so a
 * failure on one order never hides whether the others succeeded.
 */
export type BulkFulfillOrdersStepOutput = {
  /**
   * The IDs of the orders that were fulfilled successfully.
   */
  succeeded: string[]
  /**
   * The orders that failed to fulfill, along with the error message. When
   * the failure happened after the EasyPost rate was already bought (a real
   * label was purchased) but before the Medusa fulfillment could be
   * created, `easypost_shipment_id` carries the bought shipment's id so the
   * purchase isn't orphaned.
   */
  failed: {
    order_id: string
    error: string
    easypost_shipment_id?: string
  }[]
  /**
   * The URL of the consolidated PDF label batch for every order that was
   * fulfilled successfully in this call, if the batch could be generated.
   */
  label_pdf_url?: string
}

const HOLD_TAG_VALUE = "On hold"

type FulfillableItem = { id: string; quantity: BigNumberInput }

/**
 * Reads a thrown value's message without assuming it is an `Error` - a
 * non-Error throw would otherwise produce `undefined`, which JSON silently
 * drops, leaving the admin a blank failure reason. A failed nested
 * workflow's `.run()` rejects with a plain, serialized `{ message, ... }`
 * object rather than an `Error` instance (confirmed in the bulk-fulfill HTTP
 * integration tests), so that shape is read too instead of becoming
 * "[object Object]".
 */
function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (
    error &&
    typeof error === "object" &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message
  }
  if (typeof error === "string") {
    return error
  }
  try {
    return JSON.stringify(error) ?? String(error)
  } catch {
    return String(error)
  }
}

function notFulfillable(orderId: string, reason: string): MedusaError {
  return new MedusaError(
    MedusaError.Types.NOT_ALLOWED,
    `Order ${orderId} can't be fulfilled: ${reason}. No label was bought.`
  )
}

/**
 * Cheap, read-only checks for the failures `createOrderFulfillmentWorkflow`
 * would otherwise only hit AFTER the EasyPost label has been bought (real
 * money): nothing left to fulfill, a canceled order, no resolvable shipping
 * method/option or stock location, a shipping profile mismatch, the chosen
 * Ship From location not stocking an item, or a missing stock reservation.
 * Throws a descriptive error for the first problem found; returns the items
 * to fulfill otherwise. It deliberately mirrors (not replaces) the
 * workflow's own validation, which still runs.
 */
async function validateOrderIsFulfillable(
  query: { graph: (...args: any[]) => Promise<{ data: any[] }> },
  fulfillment: BulkFulfillOrdersStepInput["fulfillments"][number]
): Promise<FulfillableItem[]> {
  const orderId = fulfillment.order_id

  const {
    data: [order],
  } = await query.graph({
    entity: "order",
    filters: { id: orderId },
    fields: [
      "id",
      "status",
      "tags.value",
      "items.id",
      "items.title",
      "items.quantity",
      "items.requires_shipping",
      "items.detail.fulfilled_quantity",
      "items.variant.manage_inventory",
      "items.variant.product.shipping_profile.id",
      "items.variant.inventory_items.inventory_item_id",
      "shipping_methods.shipping_option_id",
    ],
  })

  if (!order) {
    throw notFulfillable(orderId, "the order was not found")
  }

  // Mirrors the admin hold flow (hold-order workflow): the tag whose value is
  // exactly "On hold" marks a held order. Enforced here so a stale client
  // selection can never fulfill a held order.
  if ((order.tags ?? []).some((tag) => tag?.value === HOLD_TAG_VALUE)) {
    throw notFulfillable(orderId, "Order is on hold")
  }

  if (order.status === "canceled") {
    throw notFulfillable(orderId, "the order is canceled")
  }

  const remaining = (order.items ?? [])
    .map((item) => ({
      item,
      quantity: MathBN.sub(
        item.quantity,
        item.detail?.fulfilled_quantity ?? 0
      ),
    }))
    .filter(({ quantity }) => MathBN.gt(quantity, 0))

  if (!remaining.length) {
    throw notFulfillable(orderId, "it has no unfulfilled items left")
  }

  // Same resolution createOrderFulfillmentWorkflow uses.
  const shippingOptionId = order.shipping_methods?.[0]?.shipping_option_id
  if (!shippingOptionId) {
    throw notFulfillable(
      orderId,
      "it has no shipping method with a shipping option to fulfill it through"
    )
  }

  const {
    data: [shippingOption],
  } = await query.graph({
    entity: "shipping_option",
    filters: { id: shippingOptionId },
    fields: [
      "id",
      "shipping_profile_id",
      "service_zone.fulfillment_set.location.id",
    ],
  })

  if (!shippingOption) {
    throw notFulfillable(
      orderId,
      `its shipping method's shipping option ${shippingOptionId} no longer exists`
    )
  }

  const locationId =
    fulfillment.location_id ??
    shippingOption.service_zone?.fulfillment_set?.location?.id
  if (!locationId) {
    throw notFulfillable(
      orderId,
      "no Ship From location was given and its shipping option isn't linked to a stock location"
    )
  }

  for (const { item } of remaining) {
    const profileId = item.variant?.product?.shipping_profile?.id
    if (
      item.requires_shipping &&
      profileId &&
      profileId !== shippingOption.shipping_profile_id
    ) {
      throw notFulfillable(
        orderId,
        `item "${item.title}" is in shipping profile ${profileId}, but its shipping option ${shippingOption.id} is for ${shippingOption.shipping_profile_id}`
      )
    }
  }

  const managed = remaining.filter(({ item }) => item.variant?.manage_inventory)
  if (managed.length) {
    const inventoryItemIds = [
      ...new Set(
        managed.flatMap(({ item }) =>
          (item.variant?.inventory_items ?? []).map(
            (link) => link.inventory_item_id as string
          )
        )
      ),
    ]

    const { data: levels } = inventoryItemIds.length
      ? await query.graph({
          entity: "inventory_level",
          filters: { inventory_item_id: inventoryItemIds, location_id: locationId },
          fields: ["id", "inventory_item_id", "location_id"],
        })
      : { data: [] }
    const stockedAtLocation = new Set(
      levels.map((level) => level.inventory_item_id)
    )

    const { data: reservations } = await query.graph({
      entity: "reservation",
      filters: { line_item_id: managed.map(({ item }) => item.id) },
      fields: ["id", "line_item_id"],
    })
    const reservedLineItems = new Set(
      reservations.map((reservation) => reservation.line_item_id)
    )

    for (const { item } of managed) {
      const unstocked = (item.variant?.inventory_items ?? []).some(
        (link) => !stockedAtLocation.has(link.inventory_item_id)
      )
      if (unstocked) {
        throw notFulfillable(
          orderId,
          `the Ship From location ${locationId} doesn't stock item "${item.title}"`
        )
      }

      if (!reservedLineItems.has(item.id)) {
        throw notFulfillable(
          orderId,
          `no stock reservation found for item "${item.title}"`
        )
      }
    }
  }

  return remaining.map(({ item, quantity }) => ({
    id: item.id,
    quantity: quantity as BigNumberInput,
  }))
}

export const bulkFulfillOrdersStepId = "bulk-fulfill-orders"
/**
 * This step fulfills one or more orders, one at a time, by buying the
 * EasyPost rate the admin already quoted and picked for each order, then
 * creating the order's fulfillment through
 * {@link createOrderFulfillmentWorkflow} using that bought shipment's data -
 * under the EasyPost fulfillment provider itself, whatever provider the
 * order's checkout shipping option uses, so the bought label is what the
 * fulfillment records (and what cancelling it refunds). After every order in
 * the batch has been attempted, it bundles the shipments of every
 * successfully fulfilled order into one consolidated PDF label batch.
 *
 * For each order, it only fulfills that order's own remaining unfulfilled
 * items - computed as `item.quantity - item.detail.fulfilled_quantity` for
 * every item on the order - so an order that's already `partially_fulfilled`
 * only has its remaining items fulfilled, never the ones it already shipped.
 * When no `location_id` is given, the location is resolved from the order's
 * first shipping method's shipping option, matching how a single-order
 * fulfillment resolves it.
 *
 * Before buying anything, each order is checked for the predictable
 * failures that would otherwise only surface after the label was paid for
 * (see `validateOrderIsFulfillable`); an order that fails them is reported
 * in `failed` without a label being bought.
 *
 * Each order's fulfillment attempt is wrapped in its own try/catch - one
 * order's failure never stops or rolls back any other order in the batch.
 * Buying the rate and creating the fulfillment are each wrapped separately:
 * if buying the rate fails, nothing was purchased, so the failure entry
 * carries no shipment id. If buying the rate succeeds but creating the
 * fulfillment then fails, a real label was already bought - the failure
 * entry carries `easypost_shipment_id` so that purchase is never left
 * without a record pointing back to it, and that shipment is left OUT of
 * the consolidated label batch, so a label for an order Medusa doesn't
 * consider fulfilled isn't handed out for printing. A failure while
 * generating the consolidated label batch is logged and leaves
 * `label_pdf_url` undefined; it never undoes the fulfillments (or purchases)
 * that already succeeded.
 *
 * @example
 * const data = bulkFulfillOrdersStep({
 *   fulfillments: [
 *     { order_id: "order_123", shipment_id: "shp_123", rate_id: "rate_123" },
 *     { order_id: "order_456", shipment_id: "shp_456", rate_id: "rate_456" },
 *   ]
 * })
 */
export const bulkFulfillOrdersStep = createStep(
  bulkFulfillOrdersStepId,
  async (input: BulkFulfillOrdersStepInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const easypost =
      resolveEasyPostFulfillmentProvider<EasyPostFulfillmentProviderService>(
        container
      )

    const succeeded: string[] = []
    const failed: BulkFulfillOrdersStepOutput["failed"] = []
    const fulfilledShipmentIds: string[] = []

    for (const fulfillment of input.fulfillments) {
      try {
        const items = await validateOrderIsFulfillable(query, fulfillment)

        let bought: Awaited<
          ReturnType<EasyPostFulfillmentProviderService["buyRate"]>
        >
        try {
          bought = await easypost.buyRate(
            fulfillment.shipment_id,
            fulfillment.rate_id
          )
        } catch (error) {
          // Nothing was purchased, so there's no shipment id to report.
          failed.push({
            order_id: fulfillment.order_id,
            error: errorMessage(error),
          })
          continue
        }

        // `easypost_tracking_code` is what tells the EasyPost provider's
        // createFulfillment this shipment is already bought - it adopts it
        // (after verifying it with EasyPost) instead of buying another label.
        const providerDataOverride = {
          easypost_shipment_id: bought.id,
          easypost_rate_id: fulfillment.rate_id,
          easypost_tracking_code: bought.trackingCode,
          easypost_label_url: bought.labelUrl,
          easypost_tracker_id: bought.trackerId,
        }

        try {
          await createOrderFulfillmentWorkflow(container).run({
            input: {
              order_id: fulfillment.order_id,
              items,
              location_id: fulfillment.location_id,
              provider_id: EASYPOST_FULFILLMENT_PROVIDER_ID,
              provider_data_override: providerDataOverride,
              ...(fulfillment.no_notification !== undefined
                ? { no_notification: fulfillment.no_notification }
                : {}),
            },
          })

          succeeded.push(fulfillment.order_id)
          fulfilledShipmentIds.push(bought.id)
        } catch (error) {
          // The EasyPost label was already bought (real money spent) even
          // though the Medusa fulfillment record couldn't be created -
          // carry the bought shipment's id so it isn't orphaned.
          failed.push({
            order_id: fulfillment.order_id,
            error: errorMessage(error),
            easypost_shipment_id: providerDataOverride.easypost_shipment_id,
          })
        }
      } catch (error) {
        // A failure before a rate was bought (the pre-buy validation, or
        // the order lookup itself failing) - nothing was purchased yet.
        failed.push({
          order_id: fulfillment.order_id,
          error: errorMessage(error),
        })
      }
    }

    let labelPdfUrl: string | undefined
    if (fulfilledShipmentIds.length > 0) {
      try {
        const batch = await easypost.createLabelBatch(
          fulfilledShipmentIds,
          "pdf"
        )
        labelPdfUrl = batch.labelUrl
      } catch (error) {
        const logger = container.resolve<Logger>(
          ContainerRegistrationKeys.LOGGER
        )
        logger.warn(
          `Failed to create a consolidated EasyPost label batch for shipments [${fulfilledShipmentIds.join(
            ", "
          )}]: ${errorMessage(error)}`
        )
      }
    }

    return new StepResponse({ succeeded, failed, label_pdf_url: labelPdfUrl })
  }
)
