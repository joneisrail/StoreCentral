import { ShopifyClient } from "../shopify/client.js"
import type { ShopifyConfig } from "../shopify/config.js"
import { WooCommerceClient } from "../woocommerce/client.js"
import type { WooCommerceConfig } from "../woocommerce/config.js"

export type TestResult = { ok: true; detail: string } | { ok: false; message: string }

type TestOpts = { fetchImpl?: typeof fetch; timeoutMs?: number }

const DEFAULT_TIMEOUT_MS = 10_000

class TimeoutError extends Error {}

/** Races the work against a timer; the timer is always cleared. */
const withTimeout = async <T>(work: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError("timed out")), timeoutMs)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Maps any failure to a short, credential-free message. Only the HTTP status
 * is ever extracted from the underlying error text.
 */
const describeFailure = (err: unknown): string => {
  if (err instanceof TimeoutError) return "connection timed out"
  const text = err instanceof Error ? err.message : ""
  const status = /status (\d{3})/.exec(text)?.[1]
  if (status) {
    const code = Number(status)
    if (code === 401 || code === 403) return "credentials rejected"
    if (code === 404) return "not found (check the store address)"
    return `request failed (${code})`
  }
  if (/GraphQL error/i.test(text)) return "credentials rejected or request invalid"
  return "could not reach the store"
}

const noopSleep = async (): Promise<void> => {}

const toLocationGid = (id: string): string =>
  id.startsWith("gid://") ? id : `gid://shopify/Location/${id}`

export const testShopifyConnection = async (
  config: ShopifyConfig,
  opts: TestOpts = {}
): Promise<TestResult> => {
  try {
    const client = new ShopifyClient({
      shopDomain: config.shopDomain,
      accessToken: config.accessToken,
      fetchImpl: opts.fetchImpl,
      sleep: noopSleep,
    })
    const data = await withTimeout(
      client.graphql<{ shop?: { name?: string } | null; location?: { id?: string } | null }>(
        `query ConnectionTest($id: ID!) { shop { name } location(id: $id) { id } }`,
        { id: toLocationGid(config.locationId) }
      ),
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    )
    if (!data?.location) return { ok: false, message: "location not found" }
    return { ok: true, detail: `Connected to ${data.shop?.name ?? config.shopDomain}` }
  } catch (err) {
    return { ok: false, message: describeFailure(err) }
  }
}

export const testWooCommerceConnection = async (
  config: WooCommerceConfig,
  opts: TestOpts = {}
): Promise<TestResult> => {
  if (!config.siteUrl.trim().toLowerCase().startsWith("https://")) {
    return { ok: false, message: "site URL must start with https://" }
  }
  try {
    const client = new WooCommerceClient({
      siteUrl: config.siteUrl,
      consumerKey: config.consumerKey,
      consumerSecret: config.consumerSecret,
      fetchImpl: opts.fetchImpl,
      sleep: noopSleep,
    })
    await withTimeout(
      client.request("GET", "/products", { query: { per_page: 1 } }),
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    )
    return { ok: true, detail: "Connected to WooCommerce store" }
  } catch (err) {
    return { ok: false, message: describeFailure(err) }
  }
}
