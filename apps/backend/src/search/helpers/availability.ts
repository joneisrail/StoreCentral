import type { SearchTypes } from "@medusajs/framework/types";
import { getTotalVariantAvailability } from "@medusajs/framework/utils";

/** Units each variant can sell, keyed by variant id; null without inventory. */
export type VariantAvailability = Record<string, number | null>;

/**
 * How many units of each variant are available (stocked minus reserved)
 * across every stock location, as Medusa computes `inventory_quantity` for
 * the admin. The product graph has no stock field of its own: the Store API
 * adds `inventory_quantity` in a middleware, so it is read here instead, in
 * one pass per page of products.
 */
export async function loadAvailability(
  variantIds: string[],
  { container }: SearchTypes.SearchIngestionContext,
): Promise<VariantAvailability> {
  const ids = [...new Set(variantIds)];

  if (!ids.length) {
    return {};
  }

  const availability = await getTotalVariantAvailability(container.query, {
    variant_ids: ids,
  });

  return Object.fromEntries(
    ids.map((id) => [id, availability[id]?.availability ?? null]),
  );
}
