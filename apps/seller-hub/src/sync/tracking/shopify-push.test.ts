import { afterEach, expect, test, vi } from "vitest"
import { PermanentSyncError } from "../../queue/queues.js"
import type { ShopifyClient } from "../../shopify/client.js"
import { createShopifyTrackingPush } from "./shopify-push.js"
import type { TrackingOrder } from "./types.js"

const NUMBER = "9400111899223344556677"
const URL_ = "https://track.example.com/secret-path-123"
const COMPANY = "SecretCarrierCo"

const order = (): TrackingOrder => ({
  id: "order_1",
  metadata: {},
  items: [
    { id: "li_a", sku: "SKU-A", quantity: 2 },
    { id: "li_b", sku: "SKU-B", quantity: 1 },
  ],
  fulfillments: [],
})

const fulfillment = (
  items: { lineItemId: string; quantity: number }[],
  over: Partial<TrackingOrder["fulfillments"][number]> = {}
): TrackingOrder["fulfillments"][number] => ({
  id: "ful_1",
  canceledAt: null,
  items,
  labels: [{ trackingNumber: NUMBER, trackingUrl: URL_ }],
  carrier: COMPANY,
  ...over,
})

const fo = (
  id: string,
  status: string,
  lines: { id: string; sku: string | null; remainingQuantity: number }[]
) => ({ id, status, lineItems: { nodes: lines } })

const lookup = (
  fulfillmentOrders: unknown[],
  fulfillments: { trackingInfo: { number: string | null }[] }[] = []
) => ({
  order: { fulfillmentOrders: { nodes: fulfillmentOrders }, fulfillments },
})

const openFo = () =>
  fo("gid://shopify/FulfillmentOrder/1", "OPEN", [
    { id: "gid://shopify/FulfillmentOrderLineItem/10", sku: "SKU-A", remainingQuantity: 2 },
    { id: "gid://shopify/FulfillmentOrderLineItem/11", sku: "SKU-B", remainingQuantity: 1 },
  ])

const setup = (responses: unknown[]) => {
  const graphql = vi.fn()
  for (const r of responses) graphql.mockResolvedValueOnce(r)
  const push = createShopifyTrackingPush({ graphql } as unknown as ShopifyClient)
  return { graphql, push }
}

const create = (userErrors: { field?: string[]; message: string }[] = []) => ({
  fulfillmentCreate: { fulfillment: { id: "gid://shopify/Fulfillment/1" }, userErrors },
})

const run = (
  push: ReturnType<typeof setup>["push"],
  f: TrackingOrder["fulfillments"][number],
  extra: { noNotification?: boolean; externalOrderId?: string } = {}
) =>
  push({
    order: order(),
    fulfillment: f,
    externalOrderId: extra.externalOrderId ?? "450789469",
    noNotification: extra.noNotification ?? false,
  })

afterEach(() => vi.restoreAllMocks())

test("fulfills matching lines with tracking info and notifyCustomer true", async () => {
  const { graphql, push } = setup([lookup([openFo()]), create()])
  const f = fulfillment([{ lineItemId: "li_a", quantity: 2 }])
  expect(await run(push, f)).toBe("pushed")
  expect(graphql).toHaveBeenCalledTimes(2)
  expect(graphql.mock.calls[0]![1]).toEqual({ id: "gid://shopify/Order/450789469" })
  const vars = graphql.mock.calls[1]![1] as any
  expect(vars.fulfillment.notifyCustomer).toBe(true)
  expect(vars.fulfillment.trackingInfo).toEqual({ company: COMPANY, number: NUMBER, url: URL_ })
})

test("notifyCustomer false when noNotification", async () => {
  const { graphql, push } = setup([lookup([openFo()]), create()])
  await run(push, fulfillment([{ lineItemId: "li_a", quantity: 2 }]), { noNotification: true })
  expect((graphql.mock.calls[1]![1] as any).fulfillment.notifyCustomer).toBe(false)
})

test("partial fulfillment sends only matching SKUs and min quantities", async () => {
  const { graphql, push } = setup([lookup([openFo()]), create()])
  // ships 1 of 2 of SKU-A only (case/whitespace differences in the Shopify sku)
  const foWeird = fo("gid://shopify/FulfillmentOrder/1", "IN_PROGRESS", [
    { id: "L10", sku: " sku-a ", remainingQuantity: 2 },
    { id: "L11", sku: "SKU-B", remainingQuantity: 1 },
  ])
  graphql.mockReset()
  graphql.mockResolvedValueOnce(lookup([foWeird])).mockResolvedValueOnce(create())
  await run(push, fulfillment([{ lineItemId: "li_a", quantity: 5 }]))
  const vars = graphql.mock.calls[1]![1] as any
  expect(vars.fulfillment.lineItemsByFulfillmentOrder).toEqual([
    {
      fulfillmentOrderId: "gid://shopify/FulfillmentOrder/1",
      fulfillmentOrderLineItems: [{ id: "L10", quantity: 2 }],
    },
  ])
})

test("falls back to all remaining lines when the fulfillment covers the whole order", async () => {
  const closed = fo("gid://shopify/FulfillmentOrder/2", "CLOSED", [
    { id: "L20", sku: "SKU-A", remainingQuantity: 1 },
  ])
  const half = fo("gid://shopify/FulfillmentOrder/1", "OPEN", [
    { id: "L10", sku: "SKU-A", remainingQuantity: 1 },
    { id: "L11", sku: "SKU-B", remainingQuantity: 0 },
    { id: "L12", sku: "OTHER", remainingQuantity: 3 },
  ])
  const { graphql, push } = setup([lookup([closed, half]), create()])
  await run(
    push,
    fulfillment([
      { lineItemId: "li_a", quantity: 2 },
      { lineItemId: "li_b", quantity: 1 },
    ])
  )
  expect((graphql.mock.calls[1]![1] as any).fulfillment.lineItemsByFulfillmentOrder).toEqual([
    {
      fulfillmentOrderId: "gid://shopify/FulfillmentOrder/1",
      fulfillmentOrderLineItems: [
        { id: "L10", quantity: 1 },
        { id: "L12", quantity: 3 },
      ],
    },
  ])
})

test("falls back to all remaining lines when no SKU matches", async () => {
  const { graphql, push } = setup([lookup([openFo()]), create()])
  const o = order()
  o.items[0]!.sku = "NOPE"
  await push({
    order: o,
    fulfillment: fulfillment([{ lineItemId: "li_a", quantity: 1 }]),
    externalOrderId: "1",
    noNotification: false,
  })
  const lines = (graphql.mock.calls[1]![1] as any).fulfillment.lineItemsByFulfillmentOrder[0]
    .fulfillmentOrderLineItems
  expect(lines).toHaveLength(2)
})

test("already-fulfilled order (no open fulfillment orders) returns skipped without a mutation", async () => {
  const closed = fo("gid://shopify/FulfillmentOrder/1", "CLOSED", [
    { id: "L10", sku: "SKU-A", remainingQuantity: 0 },
  ])
  const { graphql, push } = setup([lookup([closed])])
  expect(await run(push, fulfillment([{ lineItemId: "li_a", quantity: 2 }]))).toBe("skipped")
  expect(graphql).toHaveBeenCalledTimes(1)
})

test("existing fulfillment with the same tracking number returns skipped (idempotent retry)", async () => {
  const { graphql, push } = setup([
    lookup([openFo()], [{ trackingInfo: [{ number: ` ${NUMBER} ` }] }]),
  ])
  expect(await run(push, fulfillment([{ lineItemId: "li_a", quantity: 2 }]))).toBe("skipped")
  expect(graphql).toHaveBeenCalledTimes(1)
})

test("company and url omitted when null", async () => {
  const { graphql, push } = setup([lookup([openFo()]), create()])
  await run(
    push,
    fulfillment([{ lineItemId: "li_a", quantity: 2 }], {
      carrier: null,
      labels: [{ trackingNumber: NUMBER, trackingUrl: null }],
    })
  )
  const info = (graphql.mock.calls[1]![1] as any).fulfillment.trackingInfo
  expect(info).toEqual({ number: NUMBER })
  expect("company" in info).toBe(false)
  expect("url" in info).toBe(false)
})

test("userErrors become PermanentSyncError with a generic message", async () => {
  const { push } = setup([
    lookup([openFo()]),
    create([{ message: `bad number ${NUMBER} for ${URL_}` }]),
  ])
  const err = await run(push, fulfillment([{ lineItemId: "li_a", quantity: 2 }])).catch((e) => e)
  expect(err).toBeInstanceOf(PermanentSyncError)
  expect(err.message).not.toContain(NUMBER)
  expect(err.message).not.toContain("bad number")
})

test("throttled/internal userErrors are transient", async () => {
  for (const message of ["Throttled", "Internal error. Looks like something went wrong on our end."]) {
    const { push } = setup([lookup([openFo()]), create([{ message }])])
    const err = await run(push, fulfillment([{ lineItemId: "li_a", quantity: 2 }])).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(PermanentSyncError)
  }
})

test("order not found is skipped", async () => {
  const { graphql, push } = setup([{ order: null }])
  expect(await run(push, fulfillment([{ lineItemId: "li_a", quantity: 2 }]))).toBe("skipped")
  expect(graphql).toHaveBeenCalledTimes(1)
})

test("non-numeric, non-gid external order id is a permanent error without calling Shopify", async () => {
  const { graphql, push } = setup([])
  const err = await run(push, fulfillment([]), { externalOrderId: "abc" }).catch((e) => e)
  expect(err).toBeInstanceOf(PermanentSyncError)
  expect(graphql).not.toHaveBeenCalled()
})

test("an existing Order gid is used as-is", async () => {
  const { graphql, push } = setup([{ order: null }])
  await run(push, fulfillment([]), { externalOrderId: "gid://shopify/Order/77" })
  expect(graphql.mock.calls[0]![1]).toEqual({ id: "gid://shopify/Order/77" })
})

test("tracking number, url and company never appear in thrown error messages or logs", async () => {
  const logs = [
    vi.spyOn(console, "log").mockImplementation(() => {}),
    vi.spyOn(console, "error").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
  ]
  const f = fulfillment([{ lineItemId: "li_a", quantity: 2 }])
  const cases = [
    setup([lookup([openFo()]), create([{ message: `${NUMBER} ${URL_} ${COMPANY}` }])]),
    setup([lookup([openFo()]), create([{ message: `Throttled ${NUMBER}` }])]),
  ]
  for (const c of cases) {
    const err = await run(c.push, f).catch((e) => e)
    for (const secret of [NUMBER, URL_, COMPANY]) {
      expect(String(err.message)).not.toContain(secret)
    }
  }
  const logged = JSON.stringify(logs.map((l) => l.mock.calls))
  for (const secret of [NUMBER, URL_, COMPANY]) expect(logged).not.toContain(secret)
})
