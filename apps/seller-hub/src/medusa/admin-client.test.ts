import { afterAll, beforeAll, expect, test, vi } from "vitest"
import { startFakeMedusa, type FakeMedusa } from "../test-support/fake-medusa.js"
import { MedusaAdminClient } from "./admin-client.js"

// A local fake Medusa Admin API (see test-support/fake-medusa.ts) stands in
// for the real backend, so these tests need no running Medusa and no
// MEDUSA_* environment variables.
const ADMIN_EMAIL = "admin@example.com"
const ADMIN_PASSWORD = "not-a-real-password"

const amazonSalesChannelId = "sc_amazon"
const knownVariantId = "variant_known"
// A second, distinct variant (a different product than `knownVariantId`'s)
// reserved for the pricing/inventory tests below, kept separate from
// `knownVariantId` so these tests can't be affected by (or interfere with)
// the order/draft-order tests that already exercise `knownVariantId`.
const pricingVariantId = "variant_pricing"
const pricingInventoryLevelId = "ilev_pricing"

let fake: FakeMedusa
let BASE_URL: string

beforeAll(async () => {
  fake = await startFakeMedusa({
    salesChannels: [
      { id: "sc_other", name: "Shopify" },
      { id: amazonSalesChannelId, name: "Amazon" },
    ],
    variants: [
      {
        id: knownVariantId,
        product_id: "prod_known",
        sku: "SKU-KNOWN",
        price: 19.99,
        currency_code: "usd",
        inventory_quantity: 5,
        inventory_item_id: "iitem_known",
        inventory_level_id: "ilev_known",
      },
      {
        id: pricingVariantId,
        product_id: "prod_pricing",
        sku: "SKU-PRICING",
        price: 29.99,
        extra_prices: [{ amount: 24.5, currency_code: "eur" }],
        currency_code: "usd",
        inventory_quantity: 12,
        inventory_item_id: "iitem_pricing",
        inventory_level_id: pricingInventoryLevelId,
      },
    ],
  })
  BASE_URL = fake.baseUrl
})

afterAll(async () => {
  await fake.close()
})

const newClient = () =>
  new MedusaAdminClient({
    baseUrl: BASE_URL,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  })

const draftOrderInput = (
  metadata: Record<string, unknown>,
  countryCode = "us"
) => ({
  sales_channel_id: amazonSalesChannelId,
  email: "buyer@example.com",
  items: [{ variant_id: knownVariantId, quantity: 1 }],
  shipping_address: {
    first_name: "Jane",
    last_name: "Doe",
    address_1: "1 Test St",
    city: "Seattle",
    country_code: countryCode,
    postal_code: "98101",
  },
  metadata,
})

test("login caches a bearer token usable for subsequent admin calls", async () => {
  const client = newClient()
  await client.login()
  // indirectly verified by the createDraftOrder test below succeeding with a
  // 2xx, since an unauthenticated call would 401
  const loginsBefore = fake.requests.filter(
    (r) => r.path === "/auth/user/emailpass"
  ).length

  // A later authenticated call reuses the cached token instead of logging in again.
  expect(await client.findSalesChannelIdByName("Amazon")).toBe(
    amazonSalesChannelId
  )
  expect(
    fake.requests.filter((r) => r.path === "/auth/user/emailpass").length
  ).toBe(loginsBefore)
})

test("findSalesChannelIdByName finds the real \"Amazon\" sales channel", async () => {
  const client = newClient()

  const found = await client.findSalesChannelIdByName("Amazon")

  expect(found).toBe(amazonSalesChannelId)
})

test("findSalesChannelIdByName returns null for a name that doesn't exist", async () => {
  const client = newClient()

  const found = await client.findSalesChannelIdByName(
    "Does Not Exist " + Date.now()
  )

  expect(found).toBeNull()
})

test("createDraftOrder then convertDraftOrderToOrder produces a real order", async () => {
  const client = newClient()
  const draft = await client.createDraftOrder(
    draftOrderInput({ amazon_order_id: "TEST-ORDER-" + Date.now() })
  )
  expect(draft.id).toMatch(/^order_/)
  expect(fake.state.draftOrders.map((o) => o.id)).toContain(draft.id)

  const order = await client.convertDraftOrderToOrder(draft.id)
  expect(order.id).toBe(draft.id)
  expect(fake.state.orders.map((o) => o.id)).toContain(draft.id)
  expect(fake.state.draftOrders.map((o) => o.id)).not.toContain(draft.id)
})

test("findOrderByMetadata finds the order created above by its amazon_order_id", async () => {
  const client = newClient()
  const amazonOrderId = "TEST-FINDBY-" + Date.now()
  const draft = await client.createDraftOrder(
    draftOrderInput({ amazon_order_id: amazonOrderId })
  )
  await client.convertDraftOrderToOrder(draft.id)

  const found = await client.findOrderByMetadata(
    "amazon_order_id",
    amazonOrderId
  )
  expect(found?.id).toBe(draft.id)
})

test("findOrderByMetadata returns null when nothing matches", async () => {
  const client = newClient()
  const found = await client.findOrderByMetadata(
    "amazon_order_id",
    "does-not-exist-" + Date.now()
  )
  expect(found).toBeNull()
})

// `findOrderByMetadata` reads one 100-order page, so a match can only be found
// once order volume exceeds that page if the query asks for the newest orders
// first. This seeds more than a page of older orders (the fake lists them in
// insertion order unless `order=-created_at` is requested), then checks that a
// just-created order is still found and that the request carried the sort.
test("findOrderByMetadata sorts by -created_at so newer orders are never pushed off the first page", async () => {
  const sortFake = await startFakeMedusa({
    orders: Array.from({ length: 120 }, (_, i) => ({
      id: `order_old_${i}`,
      metadata: { amazon_order_id: `OLD-${i}` },
      created_at: -1000 + i,
    })),
  })
  try {
    const client = new MedusaAdminClient({
      baseUrl: sortFake.baseUrl,
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    })
    const draft = await client.createDraftOrder({
      ...draftOrderInput({ amazon_order_id: "NEWEST" }),
      sales_channel_id: "sc_any",
    })
    await client.convertDraftOrderToOrder(draft.id)

    const found = await client.findOrderByMetadata(
      "amazon_order_id",
      "NEWEST"
    )

    expect(found?.id).toBe(draft.id)
    const ordersRequest = sortFake.requests.find((r) =>
      r.path.startsWith("/admin/orders?")
    )
    expect(ordersRequest?.path).toContain("order=-created_at")
  } finally {
    await sortFake.close()
  }
})

test("createDraftOrder logs a warning instead of silently miscategorizing when no region covers the shipping country", async () => {
  // Only a region for "us" exists; the shipping address below is "zz",
  // which matches nothing, so the fallback path must fire.
  const regionFake = await startFakeMedusa({
    regions: [{ id: "reg_us_only", countries: ["us"] }],
  })

  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
  try {
    const client = new MedusaAdminClient({
      baseUrl: regionFake.baseUrl,
      email: "fake@example.com",
      password: "fake-password",
    })

    await client.createDraftOrder(draftOrderInput({}, "zz"))

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toContain("zz")
    expect(warnSpy.mock.calls[0]?.[0]).toContain("reg_us_only")
  } finally {
    warnSpy.mockRestore()
    await regionFake.close()
  }
})

test("getVariantPricing returns the variant's price in the store's default currency", async () => {
  const client = newClient()

  const pricing = await client.getVariantPricing(pricingVariantId)

  expect(pricing).toEqual({ amount: 29.99, currencyCode: "usd" })

  // Cross-check against the fake's seeded data rather than trusting our own
  // client's parsing of the response it just received.
  const seeded = fake.state.variants.find((v) => v.id === pricingVariantId)
  expect(pricing.amount).toBe(seeded?.price)
})

test("getVariantPricing throws for a variant id that doesn't exist", async () => {
  const client = newClient()

  await expect(
    client.getVariantPricing("variant_does_not_exist")
  ).rejects.toThrow(/not found/i)
})

test("getVariantInventory returns the variant's current stock quantity", async () => {
  const client = newClient()

  const inventory = await client.getVariantInventory(pricingVariantId)

  expect(typeof inventory.quantity).toBe("number")
  expect(inventory.quantity).toBeGreaterThanOrEqual(0)

  // Cross-check against the fake's seeded data.
  const seeded = fake.state.variants.find((v) => v.id === pricingVariantId)
  expect(inventory.quantity).toBe(seeded?.inventory_quantity ?? 0)
  expect(inventory.quantity).toBe(12)
})

test("getVariantInventory throws for a variant id that doesn't exist", async () => {
  const client = newClient()

  await expect(
    client.getVariantInventory("variant_does_not_exist")
  ).rejects.toThrow(/not found/i)
})

test("findVariantIdByInventoryLevelId resolves a real inventory level id to its owning variant", async () => {
  const client = newClient()

  const resolvedVariantId = await client.findVariantIdByInventoryLevelId(
    pricingInventoryLevelId
  )

  expect(resolvedVariantId).toBe(pricingVariantId)
})

test("findVariantIdByInventoryLevelId returns null for an inventory level id that doesn't exist", async () => {
  const client = newClient()

  const resolvedVariantId = await client.findVariantIdByInventoryLevelId(
    "ilev_does_not_exist"
  )

  expect(resolvedVariantId).toBeNull()
})
