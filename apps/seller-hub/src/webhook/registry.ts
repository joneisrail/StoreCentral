import type { Pool } from "pg"
import type { ConnectorManager } from "../connectors/manager.js"
import type { WebhookMarketplace, WebhookRegistry } from "./server.js"

/**
 * Adapts the connector manager to the webhook server's registry. Only live
 * connectors are visible, so a stopped connection looks unknown (404) here.
 */
export const createWebhookRegistry = (
  manager: ConnectorManager,
  known?: WebhookRegistry["known"]
): WebhookRegistry => ({
  get: (marketplace: WebhookMarketplace, accountId?: string) => {
    if (accountId !== undefined) {
      const c = manager.get(accountId)
      return c && c.marketplace === marketplace ? c.runtime.webhook : null
    }
    // list() is creation order with the legacy connector last.
    const live = manager.list(marketplace)
    const pick = live.find((c) => c.legacy) ?? live[0]
    return pick?.runtime.webhook ?? null
  },
  all: (marketplace) => manager.list(marketplace).map((c) => c.runtime.webhook),
  ...(known ? { known } : {}),
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * True when an integration_account row of this marketplace and id exists, live
 * or not, so a stopped or swapping connection answers 503 (retry) not 404.
 */
export const dbKnownConnection =
  (pool: Pool): NonNullable<WebhookRegistry["known"]> =>
  async (marketplace, accountId) => {
    if (!UUID.test(accountId)) return false
    const { rows } = await pool.query(
      `SELECT 1 FROM seller_hub.integration_account WHERE id = $1 AND marketplace = $2 LIMIT 1`,
      [accountId, marketplace]
    )
    return rows.length > 0
  }
