import { priceAttribute } from "@lib/search-client"
import type { HitPricing } from "./price"

const NEW_WINDOW_MS = 30 * 86_400_000

/**
 * Badges for a catalog card, at most two, in the order Sold out, Sale, New.
 * A hit without `in_stock` is never flagged as sold out.
 */
export const getBadges = (
  hit: { created_at?: string | null; in_stock?: boolean | null } & HitPricing,
  currencyCode: string,
  now: Date = new Date()
): string[] => {
  const badges: string[] = []

  if (hit.in_stock === false) {
    badges.push("Sold out")
  }

  if (hit[priceAttribute("on_sale", currencyCode)] === true) {
    badges.push("Sale")
  }

  if (hit.created_at) {
    const age = now.getTime() - new Date(hit.created_at).getTime()
    if (age >= 0 && age <= NEW_WINDOW_MS) {
      badges.push("New")
    }
  }

  return badges.slice(0, 2)
}
