const MAX_METADATA_VALUES = 30;

export type BrandCategoryRow = {
  name?: string | null;
  handle?: string | null;
  parent_category?: { handle?: string | null } | null;
} | null;

export type StockVariantRow = {
  id?: string | null;
  manage_inventory?: boolean | null;
  allow_backorder?: boolean | null;
  inventory_quantity?: number | null;
} | null;

function uniqueCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const key = value.toLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }

  return result;
}

/**
 * Names of the categories that sit directly under the `brands` category.
 */
export function toBrands(
  categories: BrandCategoryRow[] | null | undefined,
): string[] {
  const names = (categories ?? [])
    .filter((category) => category?.parent_category?.handle === "brands")
    .map((category) => category?.name?.trim())
    .filter((name): name is string => Boolean(name));

  return uniqueCaseInsensitive(names);
}

/**
 * Names of the non-brand categories (departments, gender, ...). Brand
 * categories, and the `brands` category itself, are left out: brands have
 * their own `brand` field, and listing them here floods the Category facet.
 * Existing indexes need a reindex to pick this up.
 */
export function toCategoryNames(
  categories: BrandCategoryRow[] | null | undefined,
): string[] {
  const names = (categories ?? [])
    .filter(
      (category) =>
        category?.handle !== "brands" &&
        category?.parent_category?.handle !== "brands",
    )
    .map((category) => category?.name?.trim())
    .filter((name): name is string => Boolean(name));

  return uniqueCaseInsensitive(names);
}

/**
 * Reads a list-like metadata value (string, comma-separated string or array)
 * into clean, de-duplicated strings, capped so one product cannot bloat the index.
 */
export function toMetadataValues(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): string[] {
  const raw = metadata?.[key];
  let items: unknown[] = [];

  if (typeof raw === "string") {
    items = raw.split(",");
  } else if (Array.isArray(raw)) {
    items = raw;
  }

  const cleaned = items
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return uniqueCaseInsensitive(cleaned).slice(0, MAX_METADATA_VALUES);
}

/**
 * Whether the product can be bought now, plus the variant id to add straight
 * to the cart when there is only one.
 */
export function toStock(variants: StockVariantRow[] | null | undefined): {
  in_stock: boolean;
  single_variant_id: string | null;
} {
  const rows = (variants ?? []).filter(
    (variant): variant is NonNullable<StockVariantRow> => variant != null,
  );

  const in_stock = rows.some(
    (variant) =>
      variant.manage_inventory === false ||
      variant.allow_backorder === true ||
      (variant.inventory_quantity ?? 0) > 0,
  );

  const withId = rows.filter((variant) => Boolean(variant.id));
  const single_variant_id =
    rows.length === 1 && withId.length === 1 ? (withId[0].id as string) : null;

  return { in_stock, single_variant_id };
}
