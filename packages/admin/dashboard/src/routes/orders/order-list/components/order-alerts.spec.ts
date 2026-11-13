import { describe, expect, it } from "vitest"

import { computeOrderAlerts } from "./order-alerts"

const okQuote = { status: "ok" as const, rates: [{}], selectedCarrier: "UPS" }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeOrder = (overrides: Record<string, unknown> = {}): any => ({
  id: "order_1",
  total: 100,
  payment_status: "captured",
  items: [{ id: "i1", variant: { weight: 5 } }],
  shipping_address: { address_1: "1 Main St", address_2: null },
  ...overrides,
})

/* eslint-disable @typescript-eslint/no-explicit-any */
const run = (order: any, quote: any = okQuote, highValueThreshold = 500) =>
  computeOrderAlerts({ order, quote, highValueThreshold }).map((a) => a.code)
/* eslint-enable @typescript-eslint/no-explicit-any */

const ok = (carrier: string | null) => ({
  status: "ok" as const,
  rates: [{}],
  selectedCarrier: carrier,
})

describe("computeOrderAlerts", () => {
  it("returns no alerts for a healthy order", () => {
    expect(run(makeOrder())).toEqual([])
  })

  it("flags missing weight when an item has no weight or weight 0", () => {
    expect(
      run(makeOrder({ items: [{ variant: { weight: null } }] }))
    ).toContain("missing_weight")
    expect(run(makeOrder({ items: [{ variant: { weight: 0 } }] }))).toContain(
      "missing_weight"
    )
    expect(
      run(
        makeOrder({
          items: [
            { variant: { weight: 2 } },
            { variant: { weight: undefined } },
          ],
        })
      )
    ).toContain("missing_weight")
  })

  it("flags missing weight when an item has no variant", () => {
    expect(run(makeOrder({ items: [{ variant: null }] }))).toContain(
      "missing_weight"
    )
  })

  it("falls back to product weight", () => {
    const order = makeOrder({
      items: [{ variant: { weight: null, product: { weight: 3 } } }],
    })
    expect(run(order)).not.toContain("missing_weight")
  })

  it("flags no_rates on error or empty ok, not on idle/loading/non-empty", () => {
    expect(run(makeOrder(), { status: "error" })).toContain("no_rates")
    expect(run(makeOrder(), { status: "ok", rates: [] })).toContain("no_rates")
    expect(run(makeOrder(), { status: "idle" })).not.toContain("no_rates")
    expect(run(makeOrder(), { status: "loading" })).not.toContain("no_rates")
    expect(run(makeOrder(), okQuote)).not.toContain("no_rates")
  })

  it("flags payment_pending unless captured/refunded states or absent", () => {
    expect(run(makeOrder({ payment_status: "awaiting" }))).toContain(
      "payment_pending"
    )
    expect(run(makeOrder({ payment_status: "not_paid" }))).toContain(
      "payment_pending"
    )
    for (const s of [
      "captured",
      "partially_captured",
      "refunded",
      "partially_refunded",
    ]) {
      expect(run(makeOrder({ payment_status: s }))).not.toContain(
        "payment_pending"
      )
    }
    expect(run(makeOrder({ payment_status: undefined }))).not.toContain(
      "payment_pending"
    )
  })

  it("po box with USPS is not an alert, with UPS/FedEx is", () => {
    const order = makeOrder({ shipping_address: { address_1: "PO Box 12" } })
    expect(run(order, ok("USPS"))).not.toContain("po_box_non_usps")
    expect(run(order, ok("usps"))).not.toContain("po_box_non_usps")
    expect(run(order, ok("UPS"))).toContain("po_box_non_usps")
    expect(run(order, ok("FedEx"))).toContain("po_box_non_usps")
    expect(run(order, ok(null))).not.toContain("po_box_non_usps")
  })

  it("po box detection is case-insensitive, checks address_2, and ignores Pomona Boulevard", () => {
    for (const a of [
      "p.o. box 5",
      "P O BOX 5",
      "Post Office Box 9",
      "PO box 7",
    ]) {
      expect(
        run(makeOrder({ shipping_address: { address_1: a } }), ok("UPS"))
      ).toContain("po_box_non_usps")
    }
    expect(
      run(
        makeOrder({
          shipping_address: { address_1: "1 Main", address_2: "PO Box 3" },
        }),
        ok("UPS")
      )
    ).toContain("po_box_non_usps")
    for (const a of ["12 Pomona Boulevard", "Compton"]) {
      expect(
        run(makeOrder({ shipping_address: { address_1: a } }), ok("UPS"))
      ).not.toContain("po_box_non_usps")
    }
  })

  it("high value boundary: equal is not an alert, above is", () => {
    expect(run(makeOrder({ total: 500 }))).not.toContain("high_value")
    expect(run(makeOrder({ total: 500.01 }))).toContain("high_value")
    const alert = computeOrderAlerts({
      order: makeOrder({ total: 900 }),
      quote: okQuote,
      highValueThreshold: 500,
    }).find((a) => a.code === "high_value")
    expect(alert?.messageKey).toBe("orders.readyToShip.alerts.high_value")
    expect(alert?.params).toMatchObject({ threshold: 500 })
  })

  it("messageKey is namespaced per code", () => {
    const alerts = computeOrderAlerts({
      order: makeOrder({ items: [{ variant: null }] }),
      quote: { status: "error" },
      highValueThreshold: 500,
    })
    expect(alerts.length).toBeGreaterThan(1)
    for (const a of alerts) {
      expect(a.messageKey).toBe(`orders.readyToShip.alerts.${a.code}`)
    }
  })

  it("malformed order (no items, no address, no total) returns []", () => {
    expect(run({})).toEqual([])
    expect(run({ items: null, shipping_address: null, total: null })).toEqual(
      []
    )
    expect(run(null)).toEqual([])
  })
})
