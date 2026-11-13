import { expect, test } from "vitest"
import type { ConnectorManager, LiveConnector } from "../connectors/manager.js"
import { createWebhookRegistry } from "./registry.js"

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
