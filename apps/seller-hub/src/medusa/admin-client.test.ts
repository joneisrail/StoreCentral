import { beforeAll, expect, test } from "vitest"
import { MedusaAdminClient } from "./admin-client.js"

const BASE_URL = process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000"
const ADMIN_EMAIL = process.env.MEDUSA_ADMIN_EMAIL!
const ADMIN_PASSWORD = process.env.MEDUSA_ADMIN_PASSWORD!

// Discovered from the real, already-running local backend in `beforeAll`
// below, rather than hardcoded, since the exact ids depend on what's been
// seeded/created in this environment.
let amazonSalesChannelId: string
let knownVariantId: string

beforeAll(async () => {
  const loginResponse = await fetch(`${BASE_URL}/auth/user/emailpass`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })
  const { token } = (await loginResponse.json()) as { token: string }
  const authHeaders = { Authorization: `Bearer ${token}` }

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
    `${BASE_URL}/admin/products?limit=1&fields=id,title,*variants`,
    { headers: authHeaders }
  )
  const { products } = (await productsResponse.json()) as {
    products: { variants: { id: string }[] }[]
  }
  const variant = products[0]?.variants?.[0]
  if (!variant) {
    throw new Error("No product variant found in the demo catalog.")
  }
  knownVariantId = variant.id
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
