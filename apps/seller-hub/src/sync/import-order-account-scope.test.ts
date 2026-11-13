import { expect, test, vi } from "vitest"
import type { Pool } from "pg"
import {
  importClaimedOrder,
  isOldestMarketplaceAccount,
  type OrderImportAdapter,
} from "./import-order.js"
import { woocommerceImportAdapter } from "./woocommerce-import-order.js"
import { shopifyImportAdapter } from "./shopify-import-order.js"
import { amazonImportAdapter } from "./import-order.js"
import { MedusaAdminClient } from "../medusa/admin-client.js"

type FakeOrder = { id: string; metadata?: Record<string, unknown> | null }

const ACCOUNT_A = "acct-a"
const ACCOUNT_B = "acct-b"

// Pool fake: every UPDATE succeeds, listings resolve SKU "S", and the
// integration_account lookup returns `oldest` for the marketplace.
const fakePool = (oldest: string) =>
  ({
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM seller_hub.integration_account")) {
        return { rows: [{ id: oldest }], rowCount: 1 }
      }
      if (sql.includes("FROM seller_hub.channel_listing")) {
        return { rows: [{ external_sku: "S", medusa_variant_id: "v1" }], rowCount: 1 }
      }
      return { rows: [], rowCount: 1 }
    }),
  }) as unknown as Pool

// Medusa fake whose findOrderByMetadata is the REAL implementation, fed a
// fixed order list through a stubbed authedFetch.
const fakeMedusa = (orders: FakeOrder[]) => {
  const client = new MedusaAdminClient({
    baseUrl: "http://x",
    email: "e",
    password: "p",
  })
  ;(client as any).authedFetch = async () => ({
    json: async () => ({ orders }),
  })
  const created: any[] = []
  client.createDraftOrder = (async (input: any) => {
    created.push(input)
    return { id: "draft_new" }
  }) as any
  client.convertDraftOrderToOrder = (async (id: string) => ({ id })) as any
  client.getOrderById = (async () => null) as any
  return { client, created }
}

const claim = { kind: "claimed", syncJobId: "j", attempts: 1, draftOrderId: null } as any

const run = (
  adapter: OrderImportAdapter<any>,
  accountId: string,
  client: MedusaAdminClient,
  oldest: string,
  externalId = "1042"
) =>
  importClaimedOrder(
    externalId,
    claim,
    async () => ({
      order: {
        status: "processing",
        currencyCode: "USD",
        buyerEmail: "a@b.co",
        items: [{ sku: "S", quantity: 1, unitPrice: 1 }],
        shippingAddress: { first_name: "A", last_name: "B", address_1: "1", city: "R", country_code: "US", postal_code: "1" },
      },
      salesChannelId: "sc",
    }),
    { pool: fakePool(oldest), integrationAccountId: accountId, medusaClient: client },
    adapter
  )

test("adapters write the marketplace account id key", () => {
  const stub = {} as any
  for (const [adapter, key] of [
    [woocommerceImportAdapter, "woocommerce_account_id"],
    [shopifyImportAdapter, "shopify_account_id"],
    [amazonImportAdapter, "amazon_account_id"],
  ] as const) {
    expect(adapter.accountMetadataKey).toBe(key)
    void stub
  }
})

test("the draft carries the account id next to the external order id", async () => {
  const { client, created } = fakeMedusa([])
  const result = await run(woocommerceImportAdapter, ACCOUNT_A, client, ACCOUNT_A)
  expect(result.status).toBe("created")
  expect(created[0].metadata).toMatchObject({
    woocommerce_order_id: "1042",
    woocommerce_account_id: ACCOUNT_A,
  })
})

test("a second account with the same external order id is imported, not recovered", async () => {
  const { client, created } = fakeMedusa([
    {
      id: "order_a",
      metadata: { woocommerce_order_id: "1042", woocommerce_account_id: ACCOUNT_A },
    },
  ])
  const result = await run(woocommerceImportAdapter, ACCOUNT_B, client, ACCOUNT_A)
  expect(result.status).toBe("created")
  expect(created).toHaveLength(1)
})

test("re-delivery for the same account is recovered", async () => {
  const { client, created } = fakeMedusa([
    {
      id: "order_a",
      metadata: { woocommerce_order_id: "1042", woocommerce_account_id: ACCOUNT_A },
    },
  ])
  const result = await run(woocommerceImportAdapter, ACCOUNT_A, client, ACCOUNT_A)
  expect(result).toEqual({ status: "recovered", medusaOrderId: "order_a" })
  expect(created).toHaveLength(0)
})

test("a legacy order without account metadata dedupes for the oldest account only", async () => {
  const legacy = [{ id: "order_old", metadata: { woocommerce_order_id: "1042" } }]

  const oldest = fakeMedusa(legacy)
  const recovered = await run(woocommerceImportAdapter, ACCOUNT_A, oldest.client, ACCOUNT_A)
  expect(recovered).toEqual({ status: "recovered", medusaOrderId: "order_old" })

  const newer = fakeMedusa(legacy)
  const created = await run(woocommerceImportAdapter, ACCOUNT_B, newer.client, ACCOUNT_A)
  expect(created.status).toBe("created")
})

test("isOldestMarketplaceAccount compares against the oldest row", async () => {
  expect(await isOldestMarketplaceAccount(fakePool("x"), "shopify", "x")).toBe(true)
  expect(await isOldestMarketplaceAccount(fakePool("x"), "shopify", "y")).toBe(false)
})
