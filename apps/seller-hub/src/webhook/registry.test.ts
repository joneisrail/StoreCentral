import type { Pool } from "pg"
import { expect, test, vi } from "vitest"
import type { ConnectorManager, LiveConnector } from "../connectors/manager.js"
import { createWebhookRegistry, dbKnownConnection } from "./registry.js"

const conn = (id: string, marketplace: "shopify" | "woocommerce", legacy = false) =>
  ({ id, marketplace, legacy, runtime: { webhook: { webhookSecret: id } } }) as unknown as LiveConnector

const manager = (list: LiveConnector[]): ConnectorManager =>
  ({
    get: (id: string) => list.find((c) => c.id === id) ?? null,
    list: (m?: string) => list.filter((c) => !m || c.marketplace === m),
  }) as unknown as ConnectorManager

const secret = (d: unknown) => (d as { webhookSecret: string } | null)?.webhookSecret ?? null

test("get with an id returns that live connector's webhook deps for its marketplace only", () => {
  const reg = createWebhookRegistry(manager([conn("a", "shopify"), conn("w", "woocommerce")]))
  expect(secret(reg.get("shopify", "a"))).toBe("a")
  expect(reg.get("woocommerce", "a")).toBeNull()
  expect(reg.get("shopify", "zzz")).toBeNull()
})

test("get without an id prefers the legacy connector, else the oldest managed", () => {
  const withLegacy = createWebhookRegistry(
    manager([conn("m1", "shopify"), conn("m2", "shopify"), conn("l", "shopify", true)])
  )
  expect(secret(withLegacy.get("shopify"))).toBe("l")
  const managedOnly = createWebhookRegistry(manager([conn("m1", "shopify"), conn("m2", "shopify")]))
  expect(secret(managedOnly.get("shopify"))).toBe("m1")
  expect(managedOnly.get("woocommerce")).toBeNull()
})

test("all returns every live connector's webhook deps of that marketplace", () => {
  const reg = createWebhookRegistry(manager([conn("a", "shopify"), conn("b", "shopify"), conn("w", "woocommerce")]))
  expect(reg.all("shopify").map(secret)).toEqual(["a", "b"])
})

test("all exposes each live connection's tracking queue and account id", () => {
  const withTracking = (id: string) =>
    ({
      id,
      marketplace: "shopify",
      legacy: false,
      runtime: { webhook: { webhookSecret: id, trackingQueue: { name: `t-${id}` }, integrationAccountId: id } },
    }) as unknown as LiveConnector
  const reg = createWebhookRegistry(manager([withTracking("a"), withTracking("b")]))
  expect(
    reg.all("shopify").map((d) => [(d as any).integrationAccountId, (d as any).trackingQueue.name])
  ).toEqual([["a", "t-a"], ["b", "t-b"]])
})

test("known is passed through to the registry", () => {
  const known = vi.fn(() => true)
  expect(createWebhookRegistry(manager([]), known).known).toBe(known)
  expect(createWebhookRegistry(manager([])).known).toBeUndefined()
})

test("dbKnownConnection checks a row of that marketplace and id, and never queries a non-uuid id", async () => {
  const id = "3f2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6b"
  const query = vi.fn(async () => ({ rows: [{ "?column?": 1 }] }))
  const known = dbKnownConnection({ query } as unknown as Pool)
  expect(await known("shopify", id)).toBe(true)
  expect(query).toHaveBeenCalledWith(expect.stringMatching(/integration_account/), [id, "shopify"])
  expect(await known("shopify", "not-a-uuid")).toBe(false)
  expect(query).toHaveBeenCalledTimes(1)
  query.mockResolvedValueOnce({ rows: [] })
  expect(await known("woocommerce", id)).toBe(false)
})
