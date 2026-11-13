import { afterEach, expect, test, vi } from "vitest"
import { loadWooCommerceConfig } from "./config.js"

const full = {
  WOOCOMMERCE_SITE_URL: "https://shop.example.com",
  WOOCOMMERCE_CONSUMER_KEY: "ck_x",
  WOOCOMMERCE_CONSUMER_SECRET: "cs_x",
  WOOCOMMERCE_WEBHOOK_SECRET: "whsec",
}

afterEach(() => vi.restoreAllMocks())

test("returns the config when all four variables are set", () => {
  expect(loadWooCommerceConfig(full)).toEqual({
    siteUrl: "https://shop.example.com",
    consumerKey: "ck_x",
    consumerSecret: "cs_x",
    webhookSecret: "whsec",
  })
})

for (const key of Object.keys(full)) {
  test(`returns null when ${key} is missing`, () => {
    const env = { ...full } as Record<string, string | undefined>
    delete env[key]
    expect(loadWooCommerceConfig(env)).toBeNull()
  })
  test(`returns null when ${key} is empty`, () => {
    expect(loadWooCommerceConfig({ ...full, [key]: "" })).toBeNull()
  })
}

test("returns null for a non-https site URL and logs one line without values", () => {
  const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
  const env = { ...full, WOOCOMMERCE_SITE_URL: "http://shop.example.com" }
  expect(loadWooCommerceConfig(env)).toBeNull()
  expect(spy).toHaveBeenCalledTimes(1)
  const line = String(spy.mock.calls[0]![0])
  expect(line).not.toContain("shop.example.com")
  expect(line).not.toContain("ck_x")
  expect(line).not.toContain("cs_x")
})

test("trims trailing slashes from the site URL", () => {
  const cfg = loadWooCommerceConfig({ ...full, WOOCOMMERCE_SITE_URL: "https://shop.example.com/" })
  expect(cfg?.siteUrl).toBe("https://shop.example.com")
})
