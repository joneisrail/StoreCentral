import type { ReadyToShipOrder } from "./order-list-table/components/ready-to-ship-table"

export type OrderAlertCode =
  | "missing_weight"
  | "no_rates"
  | "payment_pending"
  | "po_box_non_usps"
  | "high_value"

export type OrderAlert = {
  code: OrderAlertCode
  messageKey: string
  params?: Record<string, unknown>
}

export type OrderAlertQuote = {
  status: "idle" | "loading" | "error" | "ok"
  rates?: unknown[]
  selectedCarrier?: string | null
}

const PAID_STATES = new Set([
  "captured",
  "partially_captured",
  "refunded",
  "partially_refunded",
])

const PO_BOX_REGEX = /\b(p\.?\s?o\.?\s?box|post office box)\b/i

const alert = (
  code: OrderAlertCode,
  params?: Record<string, unknown>
): OrderAlert => ({
  code,
  messageKey: `orders.readyToShip.alerts.${code}`,
  ...(params ? { params } : {}),
})

type LooseItem = {
  variant?: {
    weight?: number | null
    product?: { weight?: number | null } | null
  } | null
}

const hasWeight = (item: LooseItem | null | undefined): boolean => {
  const weight = item?.variant?.weight ?? item?.variant?.product?.weight
  return typeof weight === "number" && Number.isFinite(weight) && weight > 0
}

/**
 * Pure, never-throwing alert rules for a Ready to Ship row. A missing field
 * simply yields no alert for the rule that needs it. `order.total` is in the
 * store's major units, as shown in the dashboard, and is compared undivided.
 */
export const computeOrderAlerts = ({
  order,
  quote,
  highValueThreshold,
}: {
  order: ReadyToShipOrder
  quote: OrderAlertQuote
  highValueThreshold: number
}): OrderAlert[] => {
  const alerts: OrderAlert[] = []

  try {
    const items = order?.items as LooseItem[] | null | undefined

    if (Array.isArray(items) && items.some((item) => !hasWeight(item))) {
      alerts.push(alert("missing_weight"))
    }

    if (
      quote?.status === "error" ||
      (quote?.status === "ok" && (quote.rates?.length ?? 0) === 0)
    ) {
      alerts.push(alert("no_rates"))
    }

    const paymentStatus = order?.payment_status
    if (typeof paymentStatus === "string" && !PAID_STATES.has(paymentStatus)) {
      alerts.push(alert("payment_pending", { status: paymentStatus }))
    }

    const carrier = quote?.selectedCarrier
    if (carrier && carrier.trim().toUpperCase() !== "USPS") {
      const address = order?.shipping_address
      const lines = [address?.address_1, address?.address_2]
      if (
        lines.some(
          (line) => typeof line === "string" && PO_BOX_REGEX.test(line)
        )
      ) {
        alerts.push(alert("po_box_non_usps", { carrier }))
      }
    }

    const total = order?.total
    if (
      typeof total === "number" &&
      typeof highValueThreshold === "number" &&
      total > highValueThreshold
    ) {
      alerts.push(alert("high_value", { total, threshold: highValueThreshold }))
    }
  } catch {
    // Alerts are advisory; never let a malformed order break the table.
  }

  return alerts
}
