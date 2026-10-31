import { Logger } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MathBN } from "@medusajs/framework/utils"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { createOrderFulfillmentWorkflow } from "../workflows/create-fulfillment"

// This step talks to the EasyPost fulfillment provider's service directly
// (resolved below as `fp_easypost_easypost` - the fulfillment module's
// provider loader registers each provider under
// `fp_${providerClass.identifier}_${optionName}`, and both the
// `EasyPostFulfillmentService.identifier` static field and the configured
// provider's `id` in medusa-config.ts are `"easypost"`, see
// packages/modules/fulfillment/src/services/fulfillment-provider.ts's
// `getRegistrationIdentifier`) rather than going through a
// provider-agnostic abstraction. That's a deliberate, narrow scope: the
// admin "Ready to Ship" bulk-fulfillment tool this step backs only ever
// quotes and buys rates through EasyPost, matching the same pragmatic,
// EasyPost-specific pattern already used elsewhere in this codebase (for
// example the EasyPost webhook route at
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
   * The URL of the consolidated PDF label batch for every shipment that was
   * successfully bought in this call, if the batch could be generated.
   */
  label_pdf_url?: string
}

export const bulkFulfillOrdersStepId = "bulk-fulfill-orders"
/**
 * This step fulfills one or more orders, one at a time, by buying the
 * EasyPost rate the admin already quoted and picked for each order, then
 * creating the order's fulfillment through
 * {@link createOrderFulfillmentWorkflow} using that bought shipment's data.
 * After every order in the batch has been attempted, it bundles every
 * successfully-bought shipment into one consolidated PDF label batch.
 *
 * For each order, it only fulfills that order's own remaining unfulfilled
 * items - computed as `item.quantity - item.detail.fulfilled_quantity` for
 * every item on the order - so an order that's already `partially_fulfilled`
 * only has its remaining items fulfilled, never the ones it already shipped.
 * `location_id`/`shipping_option_id` are intentionally left for
 * {@link createOrderFulfillmentWorkflow} to resolve itself (from the order's
 * first shipping method) when no `location_id` is given, matching how a
 * single-order fulfillment resolves it when it isn't explicitly provided.
 *
 * Each order's fulfillment attempt is wrapped in its own try/catch - one
 * order's failure never stops or rolls back any other order in the batch.
 * Buying the rate and creating the fulfillment are each wrapped separately:
 * if buying the rate fails, nothing was purchased, so the failure entry
 * carries no shipment id. If buying the rate succeeds but creating the
 * fulfillment then fails, a real label was already bought - the failure
 * entry carries `easypost_shipment_id` so that purchase is never left
 * without a record pointing back to it. A failure while generating the
 * consolidated label batch is logged and leaves `label_pdf_url` undefined;
 * it never undoes the fulfillments (or purchases) that already succeeded.
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
    const easypost = container.resolve(
      "fp_easypost_easypost"
    ) as EasyPostFulfillmentProviderService

    const succeeded: string[] = []
    const failed: {
      order_id: string
      error: string
      easypost_shipment_id?: string
    }[] = []
    const boughtShipmentIds: string[] = []

    for (const fulfillment of input.fulfillments) {
      try {
        const {
          data: [order],
        } = await query.graph({
          entity: "order",
          filters: { id: fulfillment.order_id },
          fields: [
            "id",
            "items.id",
            "items.quantity",
            "items.detail.fulfilled_quantity",
          ],
        })

        const items = (order?.items ?? [])
          .map((item) => ({
            id: item.id,
            quantity: MathBN.sub(
              item.quantity,
              item.detail?.fulfilled_quantity ?? 0
            ),
          }))
          .filter((item) => MathBN.gt(item.quantity, 0))

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
          failed.push({ order_id: fulfillment.order_id, error: error.message })
          continue
        }

        boughtShipmentIds.push(bought.id)

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
              provider_data_override: providerDataOverride,
            },
          })

          succeeded.push(fulfillment.order_id)
        } catch (error) {
          // The EasyPost label was already bought (real money spent) even
          // though the Medusa fulfillment record couldn't be created -
          // carry the bought shipment's id so it isn't orphaned.
          failed.push({
            order_id: fulfillment.order_id,
            error: error.message,
            easypost_shipment_id: providerDataOverride.easypost_shipment_id,
          })
        }
      } catch (error) {
        // An unexpected failure before a rate was bought (for example, the
        // order lookup itself failing) - nothing was purchased yet.
        failed.push({ order_id: fulfillment.order_id, error: error.message })
      }
    }

    let labelPdfUrl: string | undefined
    if (boughtShipmentIds.length > 0) {
      try {
        const batch = await easypost.createLabelBatch(
          boughtShipmentIds,
          "pdf"
        )
        labelPdfUrl = batch.labelUrl
      } catch (error) {
        const logger = container.resolve<Logger>(
          ContainerRegistrationKeys.LOGGER
        )
        logger.warn(
          `Failed to create a consolidated EasyPost label batch for shipments [${boughtShipmentIds.join(
            ", "
          )}]: ${error.message}`
        )
      }
    }

    return new StepResponse({ succeeded, failed, label_pdf_url: labelPdfUrl })
  }
)
