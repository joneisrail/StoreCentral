import type { ConnectorManager } from "../connectors/manager.js"
import type { WebhookMarketplace, WebhookRegistry } from "./server.js"

/**
 * Adapts the connector manager to the webhook server's registry. Only live
 * connectors are visible, so a stopped connection looks unknown (404) here.
 */
export const createWebhookRegistry = (manager: ConnectorManager): WebhookRegistry => ({
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
})
