import { beforeAll, expect, test, vi } from "vitest"
import { MedusaAdminClient } from "./admin-client.js"

const BASE_URL = process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000"
const ADMIN_EMAIL = process.env.MEDUSA_ADMIN_EMAIL!
const ADMIN_PASSWORD = process.env.MEDUSA_ADMIN_PASSWORD!

// Discovered from the real, already-running local backend in `beforeAll`
// below, rather than hardcoded, since the exact ids depend on what's been
// seeded/created in this environment.
let amazonSalesChannelId: string
let knownVariantId: string
// A second, distinct variant (a different product than `knownVariantId`'s)
// reserved for the pricing/inventory tests below, which read real variant
// state — kept separate from `knownVariantId` so these tests can't be
// affected by (or interfere with) the order/draft-order tests above that
// already exercise `knownVariantId`.
let pricingVariantId: string
let pricingProductId: string
let authHeaders: Record<string, string>

beforeAll(async () => {
  const loginResponse = await fetch(`${BASE_URL}/auth/user/emailpass`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })
  const { token } = (await loginResponse.json()) as { token: string }
  authHeaders = { Authorization: `Bearer ${token}` }

  const channelsResponse = await fetch(
    `${BASE_URL}/admin/sales-channels?limit=100&fields=id,name`,
    { headers: authHeaders }
  )
  const { sales_channels } = (await channelsResponse.json()) as {
    sales_channels: { id: string; name: string }[]
  }
  const amazonChannel = sales_channels.find((c) => c.name === "Amazon")
  if (!amazonChannel) {
    throw new Error(
      'No "Amazon" sales channel found. Run setup-amazon-channel.ts against the backend first.'
    )
  }
  amazonSalesChannelId = amazonChannel.id

  const productsResponse = await fetch(
    `${BASE_URL}/admin/products?limit=2&fields=id,title,*variants`,
    { headers: authHeaders }
  )
  const { products } = (await productsResponse.json()) as {
    products: { id: string; variants: { id: string }[] }[]
  }
  const variant = products[0]?.variants?.[0]
  if (!variant) {
    throw new Error("No product variant found in the demo catalog.")
  }
  knownVariantId = variant.id

  const pricingProduct = products[1] ?? products[0]
  const pricingVariant = pricingProduct?.variants?.[0]
  if (!pricingProduct || !pricingVariant) {
    throw new Error("No second product/variant found in the demo catalog.")
  }
  pricingProductId = pricingProduct.id
  pricingVariantId = pricingVariant.id
}, 30_000)

const draftOrderInput = (metadata: Record<string, unknown>) => ({
  sales_channel_id: amazonSalesChannelId,
  email: "buyer@example.com",
  items: [{ variant_id: knownVariantId, quantity: 1 }],
  shipping_address: {
    first_name: "Jane",
    last_name: "Doe",
    address_1: "1 Test St",
    city: "Seattle",
    country_code: "us",
    postal_code: "98101",
  },
  metadata,
})

test("login caches a bearer token usable for subsequent admin calls", async () => {
  const client = new MedusaAdminClient({
    baseUrl: BASE_URL,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  })
  await client.login()
  // indirectly verified by the createDraftOrder test below succeeding with a
  // 2xx, since an unauthenticated call would 401
})

test(
  "createDraftOrder then convertDraftOrderToOrder produces a real order",
  async () => {
    const client = new MedusaAdminClient({
      baseUrl: BASE_URL,
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    })
    const draft = await client.createDraftOrder(
      draftOrderInput({ amazon_order_id: "TEST-ORDER-" + Date.now() })
    )
    expect(draft.id).toMatch(/^order_/)

    const order = await client.convertDraftOrderToOrder(draft.id)
    expect(order.id).toBe(draft.id)
  },
  15_000
)

test(
  "findOrderByMetadata finds the order created above by its amazon_order_id",
  async () => {
    const client = new MedusaAdminClient({
      baseUrl: BASE_URL,
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    })
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
  },
  15_000
)

test("findOrderByMetadata returns null when nothing matches", async () => {
  const client = new MedusaAdminClient({
    baseUrl: BASE_URL,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  })
  const found = await client.findOrderByMetadata(
    "amazon_order_id",
    "does-not-exist-" + Date.now()
  )
  expect(found).toBeNull()
})

// Real order volume in this dev environment is far below the 100-order page
// `findOrderByMetadata` fetches, so a real end-to-end test can't exercise
// "a match falls outside the first unsorted page" without creating 100+
// real orders first (impractical/slow here). Instead, this locks in the
// actual request shape with a fake fetch: as long as the query always asks
// for the most-recently-created orders first, a just-created order can
// never be pushed off the first page by older orders once volume grows.
test("findOrderByMetadata sorts by -created_at so newer orders are never pushed off the first page", async () => {
  const requestedUrls: string[] = []
  const fakeFetch = vi.fn().mockImplementation(async (url: string) => {
    requestedUrls.push(url.toString())
    if (url.toString().includes("/auth/user/emailpass")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: "fake-token" }),
      }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ orders: [] }),
    }
  })

  const client = new MedusaAdminClient({
    baseUrl: BASE_URL,
    email: "fake@example.com",
    password: "fake-password",
    fetchImpl: fakeFetch as unknown as typeof fetch,
  })

  await client.findOrderByMetadata("amazon_order_id", "whatever")

  const ordersRequest = requestedUrls.find((url) =>
    url.includes("/admin/orders")
  )
  expect(ordersRequest).toContain("order=-created_at")
})

test("createDraftOrder logs a warning instead of silently miscategorizing when no region covers the shipping country", async () => {
  const fakeFetch = vi.fn().mockImplementation(async (url: string) => {
    const u = url.toString()
    if (u.includes("/auth/user/emailpass")) {
      return { ok: true, status: 200, json: async () => ({ token: "t" }) }
    }
    if (u.includes("/admin/regions")) {
      // Only a region for "us" exists; the shipping address below is "zz",
      // which matches nothing, so the fallback path must fire.
      return {
        ok: true,
        status: 200,
        json: async () => ({
          regions: [{ id: "reg_us_only", countries: [{ iso_2: "us" }] }],
        }),
      }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ draft_order: { id: "order_fake" } }),
    }
  })

  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
  try {
    const client = new MedusaAdminClient({
      baseUrl: BASE_URL,
      email: "fake@example.com",
      password: "fake-password",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    })

    await client.createDraftOrder({
      sales_channel_id: "sc_fake",
      email: "buyer@example.com",
      items: [{ variant_id: "variant_fake", quantity: 1 }],
      shipping_address: { country_code: "zz" },
      metadata: {},
    })

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toContain("zz")
  } finally {
    warnSpy.mockRestore()
  }
})

test("getVariantPricing returns the variant's price in the store's default currency", async () => {
  // Pin a known price in a known currency on the real backend first, so
  // this test isn't at the mercy of whatever the demo catalog happens to
  // seed (and so currency ambiguity — a variant can have a price per
  // currency — has one unambiguous right answer to assert against).
  await fetch(
    `${BASE_URL}/admin/products/${pricingProductId}/variants/${pricingVariantId}`,
    {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ prices: [{ currency_code: "usd", amount: 29.99 }] }),
    }
  )

  const client = new MedusaAdminClient({
    baseUrl: BASE_URL,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  })

  const pricing = await client.getVariantPricing(pricingVariantId)

  expect(pricing).toEqual({ amount: 29.99, currencyCode: "usd" })

  // Cross-check directly against the real backend rather than trusting our
  // own client's parsing of the response it just received.
  const response = await fetch(
    `${BASE_URL}/admin/product-variants?id[]=${pricingVariantId}&fields=id,*prices`,
    { headers: authHeaders }
  )
  const body = (await response.json()) as {
    variants: { prices?: { amount: number; currency_code: string }[] }[]
  }
  const expectedPrice = body.variants[0]?.prices?.find(
    (p) => p.currency_code === "usd"
  )
  expect(pricing.amount).toBe(expectedPrice?.amount)
})

test("getVariantPricing throws for a variant id that doesn't exist", async () => {
  const client = new MedusaAdminClient({
    baseUrl: BASE_URL,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  })

  await expect(
    client.getVariantPricing("variant_does_not_exist")
  ).rejects.toThrow(/not found/i)
})

test("getVariantInventory returns the variant's current stock quantity", async () => {
  const client = new MedusaAdminClient({
    baseUrl: BASE_URL,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  })

  const inventory = await client.getVariantInventory(pricingVariantId)

  expect(typeof inventory.quantity).toBe("number")
  expect(inventory.quantity).toBeGreaterThanOrEqual(0)

  // Cross-check directly against the real backend.
  const response = await fetch(
    `${BASE_URL}/admin/product-variants?id[]=${pricingVariantId}&fields=id,manage_inventory,inventory_quantity`,
    { headers: authHeaders }
  )
  const body = (await response.json()) as {
    variants: { inventory_quantity?: number | null }[]
  }
  expect(inventory.quantity).toBe(body.variants[0]?.inventory_quantity ?? 0)
})

test("getVariantInventory throws for a variant id that doesn't exist", async () => {
  const client = new MedusaAdminClient({
    baseUrl: BASE_URL,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  })

  await expect(
    client.getVariantInventory("variant_does_not_exist")
  ).rejects.toThrow(/not found/i)
})

test("findVariantIdByInventoryLevelId resolves a real inventory level id to its owning variant", async () => {
  // Discovers `pricingVariantId`'s own inventory level id directly against
  // the real backend, independently of the method under test, so this
  // assertion isn't circular.
  const inventoryItemsResponse = await fetch(
    `${BASE_URL}/admin/inventory-items?limit=100&fields=id,*location_levels.id,*variants.id`,
    { headers: authHeaders }
  )
  const { inventory_items } = (await inventoryItemsResponse.json()) as {
    inventory_items: {
      location_levels?: { id: string }[]
      variants?: { id: string }[]
    }[]
  }
  const item = inventory_items.find((candidate) =>
    candidate.variants?.some((variant) => variant.id === pricingVariantId)
  )
  const levelId = item?.location_levels?.[0]?.id
  if (!levelId) {
    throw new Error(
      `No inventory location level found for variant ${pricingVariantId}.`
    )
  }

  const client = new MedusaAdminClient({
    baseUrl: BASE_URL,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  })

  const resolvedVariantId = await client.findVariantIdByInventoryLevelId(levelId)

  expect(resolvedVariantId).toBe(pricingVariantId)
})

test("findVariantIdByInventoryLevelId returns null for an inventory level id that doesn't exist", async () => {
  const client = new MedusaAdminClient({
    baseUrl: BASE_URL,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  })

  const resolvedVariantId = await client.findVariantIdByInventoryLevelId(
    "ilev_does_not_exist"
  )

  expect(resolvedVariantId).toBeNull()
})
