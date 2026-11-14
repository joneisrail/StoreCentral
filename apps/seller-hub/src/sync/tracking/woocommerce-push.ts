import { PermanentSyncError } from "../../queue/queues.js"
import { WooCommerceHttpError, type WooCommerceClient } from "../../woocommerce/client.js"
import { coversWholeOrder } from "./coverage.js"
import type { TrackingPush } from "./types.js"

/** Order statuses where shipping tracking must not be pushed. */
const DEAD_STATUSES = new Set(["cancelled", "refunded", "failed", "trash"])
const MAX_NOTE_PAGES = 20

type WooOrder = { status?: string }
type WooNote = { note?: string }

/** Strips markup brackets and line breaks so values cannot inject HTML/lines. */
const clean = (value: string): string =>
  value.replace(/[<>\r\n]+/g, " ").replace(/\s+/g, " ").trim()

const isNotFound = (err: unknown): boolean =>
  err instanceof WooCommerceHttpError && err.status === 404

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * Pushes a Medusa shipment's tracking to WooCommerce as an order note
 * (customer-visible unless noNotification) and, for a whole-order shipment,
 * completes the order. Errors carry no tracking data: the client's own
 * generic errors propagate (429/5xx/network transient, other 4xx permanent).
 */
export const createWooCommerceTrackingPush =
  (client: WooCommerceClient): TrackingPush =>
  async ({ order, fulfillment, externalOrderId, noNotification }) => {
    const id = externalOrderId.trim()
    if (!/^\d+$/.test(id)) {
      throw new PermanentSyncError("WooCommerce order id is not numeric")
    }
    const label = fulfillment.labels[0]
    if (!label) return "skipped"
    const trackingNumber = clean(label.trackingNumber)
    if (!trackingNumber) throw new PermanentSyncError("WooCommerce tracking number is blank")

    let wooOrder: WooOrder
    try {
      wooOrder = (await client.request<WooOrder>("GET", `/orders/${id}`)).data
    } catch (err) {
      if (isNotFound(err)) return "skipped"
      throw err
    }
    const status = wooOrder?.status ?? ""
    if (DEAD_STATUSES.has(status)) return "skipped"

    // Exactly the phrase this code writes, not any note that mentions the number.
    const notePattern = new RegExp(
      `Tracking number: ${escapeRegExp(trackingNumber)}(?![A-Za-z0-9])`
    )
    // Idempotency: a retry after a lost success record must not duplicate.
    let noteExists = false
    for (let page = 1; page <= MAX_NOTE_PAGES && !noteExists; page++) {
      const res = await client.request<WooNote[]>("GET", `/orders/${id}/notes`, {
        query: { per_page: 100, page },
      })
      noteExists = (res.data ?? []).some((n) => notePattern.test(n.note ?? ""))
      if (page >= res.totalPages) break
    }

    let wrote = false
    if (!noteExists) {
      const carrier = clean(fulfillment.carrier ?? "") || "carrier"
      const url = clean(label.trackingUrl ?? "")
      const note =
        `Shipped via ${carrier}. Tracking number: ${trackingNumber}` +
        (url ? ` - ${url}` : "")
      await client.request("POST", `/orders/${id}/notes`, {
        body: { note, customer_note: !noNotification },
      })
      wrote = true
    }

    if (status !== "completed" && coversWholeOrder(order.items, fulfillment.items)) {
      await client.request("PUT", `/orders/${id}`, { body: { status: "completed" } })
      wrote = true
    }
    return wrote ? "pushed" : "skipped"
  }
