/**
 * EasyPost tracking webhook ("tracker.updated" events).
 *
 * Step 1 investigation (Task 8): confirmed empirically against the real,
 * running local backend (via `npx medusa exec` + the real
 * `ContainerRegistrationKeys.QUERY` container registration, not assumed)
 * that Medusa's Query Graph CAN filter the `fulfillment` entity by a nested
 * `data` field, e.g. `filters: { data: { easypost_tracking_code: "..." } }`,
 * even though `FilterableFulfillmentProps` (packages/core/types/src/fulfillment/common/fulfillment.ts
 * in the StoreCentral worktree) does not list `data` as a typed filter
 * field -- the underlying query layer accepts it anyway. That is the lookup
 * mechanism used below (the `created_at`-bounded client-side-scan fallback
 * described in the task brief was not needed).
 *
 * `EASYPOST_WEBHOOK_SECRET` is read directly from `process.env` here, the
 * same way `medusa-config.ts` reads `EASYPOST_API_KEY` directly when
 * building the provider's options object, rather than resolving the
 * Fulfillment Module's stored provider options at request time.
 */
import {
  createShipmentWorkflow,
  markFulfillmentAsDeliveredWorkflow,
} from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { EasyPostClient } from "@dtc/fulfillment-easypost"

const SIGNATURE_HEADER = "x-hmac-signature"

// EasyPost tracker statuses that represent the package already physically
// moving but not yet delivered. Any of these marks the fulfillment shipped
// (via createShipmentWorkflow) if it hasn't been already. "delivered" is
// handled separately below; every other status (unknown, failure,
// cancelled, return_to_sender, available_for_pickup, ...) is a deliberate
// no-op -- this route only acts on the two statuses the brief asks for.
const IN_TRANSIT_STATUSES = new Set(["pre_transit", "in_transit", "out_for_delivery"])

type EasyPostTrackerWebhookBody = {
  description?: string
  result?: {
    tracking_code?: string
    status?: string
    public_url?: string
  }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const rawBody = req.rawBody
  const rawSignatureHeader = req.headers[SIGNATURE_HEADER]
  const signatureHeader = Array.isArray(rawSignatureHeader)
    ? rawSignatureHeader[0]
    : rawSignatureHeader
  const webhookSecret = process.env.EASYPOST_WEBHOOK_SECRET
  const apiKey = process.env.EASYPOST_API_KEY

  // Fail closed: without a raw body, a configured secret, or a signature
  // header, authenticity cannot be verified, so the request is rejected
  // the same way an invalid signature would be -- never fall through to
  // processing an unverifiable request.
  if (!rawBody || !webhookSecret || !signatureHeader) {
    res.status(401).json({ message: "Invalid webhook signature" })
    return
  }

  const client = new EasyPostClient({ apiKey: apiKey ?? "" })
  const isValidSignature = client.verifyWebhookSignature(
    rawBody,
    signatureHeader,
    webhookSecret
  )

  if (!isValidSignature) {
    res.status(401).json({ message: "Invalid webhook signature" })
    return
  }

  // The JSON bodyparser already rejects an unparseable body with 400 before
  // this handler ever runs (confirmed against the real running backend --
  // see the task report), so `req.body` is guaranteed to be valid JSON here.
  const body = req.body as EasyPostTrackerWebhookBody
  const trackingCode = body?.result?.tracking_code
  const status = body?.result?.status

  if (!trackingCode || !status) {
    // Not a tracker-update-shaped payload (or missing the fields this route
    // acts on) -- nothing to do, but still a successfully handled webhook.
    res.sendStatus(200)
    return
  }

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    const { data: matches } = await query.graph({
      entity: "fulfillment",
      fields: [
        "id",
        "shipped_at",
        "delivered_at",
        "canceled_at",
        "shipping_option_id",
        "labels.tracking_number",
        "labels.tracking_url",
        "labels.label_url",
      ],
      // `data` is not part of `FilterableFulfillmentProps`'s typed filters,
      // but is accepted by the real query layer -- see this file's top
      // comment for how that was confirmed.
      filters: {
        data: { easypost_tracking_code: trackingCode },
      } as Record<string, unknown>,
    })

    const fulfillment = matches[0]

    if (!fulfillment || fulfillment.canceled_at) {
      // Unknown tracking code, or a fulfillment we should no longer touch.
      res.sendStatus(200)
      return
    }

    if (status === "delivered") {
      if (!fulfillment.delivered_at) {
        await markFulfillmentAsDeliveredWorkflow(req.scope).run({
          input: { id: fulfillment.id },
        })
      }
    } else if (IN_TRANSIT_STATUSES.has(status) && !fulfillment.shipped_at) {
      const existingLabels = (fulfillment.labels ?? [])
        .filter((label: any) => label?.tracking_number)
        .map((label: any) => ({
          tracking_number: label.tracking_number,
          tracking_url: label.tracking_url ?? "",
          label_url: label.label_url ?? "",
        }))

      // createShipmentWorkflow also requires a shipping option, and throws
      // if this fulfillment was created without one -- skip it (still a
      // 200) rather than letting that throw escape as a 500.
      if (fulfillment.shipping_option_id) {
        await createShipmentWorkflow(req.scope).run({
          input: {
            id: fulfillment.id,
            labels: existingLabels.length
              ? existingLabels
              : [
                  {
                    tracking_number: trackingCode,
                    tracking_url: body.result?.public_url ?? "",
                    label_url: "",
                  },
                ],
          },
        })
      }
    }
  } catch (error) {
    // Per this route's own contract (see the task brief): any outcome other
    // than a bad signature or an unparseable body returns 200. EasyPost
    // retries non-2xx responses, and a transient/logic error here should
    // not trigger a webhook retry storm -- log it and still acknowledge.
    const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
    logger.error(
      `Error processing EasyPost webhook for tracking code ${trackingCode}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }

  res.sendStatus(200)
}
