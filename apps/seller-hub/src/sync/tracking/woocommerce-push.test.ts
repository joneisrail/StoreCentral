import { afterEach, expect, test, vi } from "vitest"
import { PermanentSyncError } from "../../queue/queues.js"
import type { WooCommerceClient } from "../../woocommerce/client.js"
import { createWooCommerceTrackingPush } from "./woocommerce-push.js"
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

const WHOLE = [
  { lineItemId: "li_a", quantity: 2 },
  { lineItemId: "li_b", quantity: 1 },
]

const fulfillment = (
  items = WHOLE,
  over: Partial<TrackingOrder["fulfillments"][number]> = {}
): TrackingOrder["fulfillments"][number] => ({
  id: "ful_1",
  canceledAt: null,
  items,
  labels: [{ trackingNumber: NUMBER, trackingUrl: URL_ }],
  carrier: COMPANY,
  ...over,
})

type Call = { method: string; path: string; body?: any }

const setup = (
  opts: {
    status?: string
    notes?: { note: string }[]
    failOn?: (method: string, path: string) => Error | undefined
  } = {}
) => {
  const calls: Call[] = []
  const request = vi.fn(async (method: string, path: string, o: any = {}) => {
    calls.push({ method, path, body: o.body })
    const err = opts.failOn?.(method, path)
    if (err) throw err
    if (method === "GET" && path.endsWith("/notes")) {
      return { data: opts.notes ?? [], totalPages: 1 }
    }
    if (method === "GET") {
      return { data: { id: 123, status: opts.status ?? "processing" }, totalPages: 1 }
    }
    return { data: {}, totalPages: 1 }
  })
  const push = createWooCommerceTrackingPush({ request } as unknown as WooCommerceClient)
  return { calls, request, push }
}

const run = (
  push: ReturnType<typeof setup>["push"],
  f = fulfillment(),
  extra: { noNotification?: boolean; externalOrderId?: string } = {}
) =>
  push({
    order: order(),
    fulfillment: f,
    externalOrderId: extra.externalOrderId ?? "123",
    noNotification: extra.noNotification ?? false,
  })

const writes = (calls: Call[]) => calls.filter((c) => c.method !== "GET")

afterEach(() => vi.restoreAllMocks())

test("adds a customer note with carrier, number and link then completes the order", async () => {
  const { calls, push } = setup()
  expect(await run(push)).toBe("pushed")
  expect(calls).toEqual([
    { method: "GET", path: "/orders/123", body: undefined },
    { method: "GET", path: "/orders/123/notes", body: undefined },
    {
      method: "POST",
      path: "/orders/123/notes",
      body: {
        note: `Shipped via ${COMPANY}. Tracking number: ${NUMBER} - ${URL_}`,
        customer_note: true,
      },
    },
    { method: "PUT", path: "/orders/123", body: { status: "completed" } },
  ])
})

test("customer_note false when noNotification", async () => {
  const { calls, push } = setup()
  await run(push, fulfillment(), { noNotification: true })
  expect(calls.find((c) => c.method === "POST")?.body.customer_note).toBe(false)
})

test("existing note containing the tracking number is not duplicated", async () => {
  const { calls, push } = setup({ notes: [{ note: `Shipped. ${NUMBER}` }] })
  expect(await run(push)).toBe("pushed")
  expect(calls.some((c) => c.method === "POST")).toBe(false)
  expect(writes(calls)).toEqual([
    { method: "PUT", path: "/orders/123", body: { status: "completed" } },
  ])
})

test("already completed order with existing note => skipped and no writes", async () => {
  const { calls, push } = setup({ status: "completed", notes: [{ note: NUMBER }] })
  expect(await run(push)).toBe("skipped")
  expect(writes(calls)).toEqual([])
})

test("already completed order without the note only adds the note", async () => {
  const { calls, push } = setup({ status: "completed" })
  expect(await run(push)).toBe("pushed")
  expect(writes(calls).map((c) => `${c.method} ${c.path}`)).toEqual(["POST /orders/123/notes"])
})

test.each(["cancelled", "refunded", "failed", "trash"])(
  "%s order is skipped without writes",
  async (status) => {
    const { calls, push } = setup({ status })
    expect(await run(push)).toBe("skipped")
    expect(writes(calls)).toEqual([])
    expect(calls.some((c) => c.path.endsWith("/notes"))).toBe(false)
  }
)

test("404 on the order => skipped", async () => {
  const { calls, push } = setup({
    failOn: (m, p) =>
      m === "GET" && p === "/orders/123"
        ? new PermanentSyncError("WooCommerce request failed with status 404")
        : undefined,
  })
  expect(await run(push)).toBe("skipped")
  expect(writes(calls)).toEqual([])
})

test("other 4xx on the order stays permanent", async () => {
  const { push } = setup({
    failOn: () => new PermanentSyncError("WooCommerce request failed with status 401"),
  })
  await expect(run(push)).rejects.toBeInstanceOf(PermanentSyncError)
})

test("partial shipment adds the note but does not complete the order", async () => {
  const { calls, push } = setup()
  expect(await run(push, fulfillment([{ lineItemId: "li_a", quantity: 2 }]))).toBe("pushed")
  expect(writes(calls).map((c) => `${c.method} ${c.path}`)).toEqual(["POST /orders/123/notes"])
})

test("partial shipment with the note already present is skipped", async () => {
  const { calls, push } = setup({ notes: [{ note: NUMBER }] })
  expect(await run(push, fulfillment([{ lineItemId: "li_a", quantity: 2 }]))).toBe("skipped")
  expect(writes(calls)).toEqual([])
})

test("markup/newlines in carrier or url are stripped from the note", async () => {
  const { calls, push } = setup()
  await run(
    push,
    fulfillment(WHOLE, {
      carrier: "Evil<script>\nCo",
      labels: [{ trackingNumber: ` ${NUMBER}\n`, trackingUrl: "https://x.example/<b>a\r\nb" }],
    })
  )
  const note: string = calls.find((c) => c.method === "POST")?.body.note
  expect(note).not.toMatch(/[<>\r\n]/)
  expect(note).toContain(`Tracking number: ${NUMBER}`)
})

test("falls back to a generic carrier and omits the link when absent", async () => {
  const { calls, push } = setup()
  await run(
    push,
    fulfillment(WHOLE, { carrier: null, labels: [{ trackingNumber: NUMBER, trackingUrl: null }] })
  )
  expect(calls.find((c) => c.method === "POST")?.body.note).toBe(
    `Shipped via carrier. Tracking number: ${NUMBER}`
  )
})

test("blank tracking number and non-numeric order id are permanent errors", async () => {
  const a = setup()
  await expect(
    run(a.push, fulfillment(WHOLE, { labels: [{ trackingNumber: "  ", trackingUrl: null }] }))
  ).rejects.toBeInstanceOf(PermanentSyncError)
  expect(a.request).not.toHaveBeenCalled()

  const b = setup()
  await expect(run(b.push, fulfillment(), { externalOrderId: "12/../x" })).rejects.toBeInstanceOf(
    PermanentSyncError
  )
  expect(b.request).not.toHaveBeenCalled()
})

test("429/5xx propagate as transient", async () => {
  for (const msg of [
    "WooCommerce request still throttled after retries",
    "WooCommerce request failed with status 503",
  ]) {
    const { push } = setup({ failOn: () => new Error(msg) })
    const err = await run(push).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(PermanentSyncError)
  }
})

test("secrets/tracking never appear in thrown messages or logs", async () => {
  const logs = [
    vi.spyOn(console, "log").mockImplementation(() => {}),
    vi.spyOn(console, "error").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
  ]
  const errs: unknown[] = []
  for (const failOn of [
    () => new PermanentSyncError("WooCommerce request failed with status 400"),
    () => new Error("WooCommerce request failed with status 500"),
  ]) {
    const { push } = setup({ failOn: (m) => (m === "POST" ? failOn() : undefined) })
    errs.push(await run(push).catch((e) => e))
  }
  errs.push(
    await run(setup().push, fulfillment(), { externalOrderId: `${NUMBER}x` }).catch((e) => e)
  )
  errs.push(
    await run(
      setup().push,
      fulfillment(WHOLE, { labels: [{ trackingNumber: " ", trackingUrl: URL_ }] })
    ).catch((e) => e)
  )
  const text =
    errs.map((e) => String((e as Error).message)).join("|") +
    JSON.stringify(logs.map((l) => l.mock.calls))
  for (const secret of [NUMBER, URL_, COMPANY]) expect(text).not.toContain(secret)
})
