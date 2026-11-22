import { afterEach, expect, test } from "vitest"
import net from "node:net"
import { startFakeMedusa, type FakeMedusa } from "./fake-medusa.js"

let fake: FakeMedusa | undefined

afterEach(async () => {
  await fake?.close()
  fake = undefined
})

const login = async (baseUrl: string): Promise<string> => {
  const response = await fetch(`${baseUrl}/auth/user/emailpass`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "a@b.c", password: "x" }),
  })
  return ((await response.json()) as { token: string }).token
}

test("login returns a token", async () => {
  fake = await startFakeMedusa()
  const token = await login(fake.baseUrl)
  expect(token).toBeTruthy()
  expect(fake.requests).toEqual([
    { method: "POST", path: "/auth/user/emailpass" },
  ])
})

test("an unknown route returns 404", async () => {
  fake = await startFakeMedusa()
  const token = await login(fake.baseUrl)
  const response = await fetch(`${fake.baseUrl}/admin/nope`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(response.status).toBe(404)
})

test("an admin route without a valid token returns 401", async () => {
  fake = await startFakeMedusa()
  const response = await fetch(`${fake.baseUrl}/admin/sales-channels`)
  expect(response.status).toBe(401)
})

test("unauthorizedResponses expires the token once, so a re-login is needed", async () => {
  fake = await startFakeMedusa({ unauthorizedResponses: 1 })
  const base = fake.baseUrl
  const get = (token: string) =>
    fetch(`${base}/admin/sales-channels`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  const first = await login(base)
  expect((await get(first)).status).toBe(401)
  expect((await get(first)).status).toBe(401)
  expect((await get(await login(base))).status).toBe(200)
})

test("seeded state is served and handlers override the defaults", async () => {
  fake = await startFakeMedusa({
    salesChannels: [{ id: "sc_1", name: "Amazon" }],
  })
  const token = await login(fake.baseUrl)
  const response = await fetch(`${fake.baseUrl}/admin/sales-channels`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(await response.json()).toEqual({
    sales_channels: [{ id: "sc_1", name: "Amazon" }],
  })
})

test("close() frees the port", async () => {
  fake = await startFakeMedusa()
  const port = Number(new URL(fake.baseUrl).port)
  await fake.close()
  fake = undefined

  await new Promise<void>((resolve, reject) => {
    const probe = net.createServer()
    probe.once("error", reject)
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve()))
  })
})

test("serves channel push-values and records sync results", async () => {
  fake = await startFakeMedusa({
    pushValues: { "v1/sc1": { price: null, effective_price: 9.5, stock: 3 } },
  })
  const token = await login(fake.baseUrl)
  const headers = { Authorization: `Bearer ${token}` }
  const base = `${fake.baseUrl}/admin/channel-offers/v1/sc1`

  const values = await fetch(`${base}/push-values`, { headers })
  expect(await values.json()).toEqual({
    price: null,
    effective_price: 9.5,
    stock: 3,
  })
  expect(
    (await fetch(`${fake.baseUrl}/admin/channel-offers/v2/sc1/push-values`, { headers }))
      .status
  ).toBe(404)

  await fetch(`${base}/sync-result`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ state: "synced", price: 9.5 }),
  })
  expect(fake.state.syncResults).toEqual([
    {
      variantId: "v1",
      salesChannelId: "sc1",
      body: { state: "synced", price: 9.5 },
    },
  ])
})

test("extra_prices are emitted before the default-currency price", async () => {
  fake = await startFakeMedusa({
    variants: [
      {
        id: "v1",
        product_id: "p1",
        sku: null,
        price: 10,
        currency_code: "usd",
        extra_prices: [{ amount: 9, currency_code: "eur" }],
        inventory_quantity: 1,
        inventory_item_id: "ii1",
        inventory_level_id: "il1",
      },
    ],
  })
  const token = await login(fake.baseUrl)
  const response = await fetch(`${fake.baseUrl}/admin/product-variants?id[]=v1`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = (await response.json()) as {
    variants: { prices: { amount: number; currency_code: string }[] }[]
  }
  expect(body.variants[0]!.prices).toEqual([
    { amount: 9, currency_code: "eur" },
    { amount: 10, currency_code: "usd" },
  ])
})
