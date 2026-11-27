import type { SearchTypes } from "@medusajs/framework/types";
import {
  defineSearchIndex,
  graphConsume,
  graphSeed,
  search,
} from "@medusajs/framework/utils";

import { loadAvailability, VariantAvailability } from "./helpers/availability";
import {
  BrandCategoryRow,
  StockVariantRow,
  toBrands,
  toCategoryNames,
  toMetadataValues,
  toSkus,
  toStock,
} from "./helpers/fragrance";
import { ProductOptionRow, toOptionValues } from "./helpers/option-values";
import { loadPricing, priceFields, toProductPricing } from "./helpers/pricing";
import { resolveProductIds } from "./helpers/resolve-product-ids";

const PRODUCT_GRAPH_FIELDS = [
  "id",
  "title",
  "description",
  "handle",
  "thumbnail",
  "status",
  "created_at",
  "metadata",
  "sales_channels.id",
  "categories.name",
  "categories.handle",
  "categories.parent_category.handle",
  "tags.value",
  "options.title",
  "options.values.value",
  // Stock quantities are not graph fields: `loadAvailability` reads them.
  "variants.id",
  "variants.sku",
  "variants.manage_inventory",
  "variants.allow_backorder",
];

type ProductRow = {
  id: string;
  title?: string | null;
  description?: string | null;
  handle?: string | null;
  thumbnail?: string | null;
  status?: string | null;
  created_at?: string | Date | null;
  deleted_at?: string | Date | null;
  metadata?: Record<string, unknown> | null;
  sales_channels?: ({ id?: string | null } | null)[] | null;
  categories?: BrandCategoryRow[] | null;
  tags?: ({ value?: string | null } | null)[] | null;
  options?: ProductOptionRow[] | null;
  variants?: StockVariantRow[] | null;
};

const productFields = search.define({
  id: search.keyword().filterable().retrievable(),
  // Read by `/store/search` to scope the index; never returned to hits.
  status: search.keyword().filterable().retrievable(false),
  sales_channel_ids: search.keyword().array().filterable().retrievable(false),
  title: search.text().searchable({ weight: 3 }).sortable().retrievable(),
  description: search.text().searchable({ weight: 1 }),
  handle: search.keyword().retrievable(),
  // Returned on hits only: never filtered, sorted or faceted on.
  thumbnail: search.keyword().retrievable(),
  created_at: search.date().sortable().retrievable(),
  category: search.keyword().array().filterable().facetable().retrievable(),
  labels: search.keyword().array().filterable().facetable().retrievable(),
  // Codes matched whole or by prefix, never fuzzily (typo tolerance is off on
  // it). Weight 2 ranks it below title (3) and level with option values, above
  // description (1) and notes (not searchable).
  sku: search.keyword().array().searchable({ weight: 2 }).retrievable(),
  option_values: search
    .keyword()
    .array()
    .searchable({ weight: 2 })
    .filterable()
    .facetable()
    .retrievable(),
  brand: search.keyword().array().filterable().facetable().retrievable(),
  gender: search.keyword().array().filterable().facetable().retrievable(),
  fragrance_family: search
    .keyword()
    .array()
    .filterable()
    .facetable()
    .retrievable(),
  notes: search.keyword().array().filterable().facetable().retrievable(),
  concentration: search
    .keyword()
    .array()
    .filterable()
    .facetable()
    .retrievable(),
  in_stock: search.boolean().filterable().facetable().retrievable(),
  single_variant_id: search.keyword().retrievable(),
  ...priceFields,
});

type ProductDocument = SearchTypes.InferSearchDocumentType<
  typeof productFields
>;

/**
 * Variant ids of a page of products, to read their availability in one pass.
 */
function variantIds(rows: ProductRow[]): string[] {
  return rows
    .flatMap((row) => row.variants ?? [])
    .map((variant) => variant?.id)
    .filter((id): id is string => Boolean(id));
}

/**
 * The product's variants with the read availability as their quantity. A
 * variant missing from `availability` keeps whatever the row carried.
 */
function withAvailability(
  variants: StockVariantRow[] | null | undefined,
  availability: VariantAvailability | undefined,
): StockVariantRow[] {
  return (variants ?? []).map((variant) =>
    variant?.id && availability && variant.id in availability
      ? { ...variant, inventory_quantity: availability[variant.id] }
      : variant,
  );
}

export function toDocument(
  product: ProductRow,
  pricing: Parameters<typeof toProductPricing>[0],
  availability?: VariantAvailability,
): ProductDocument {
  const category = toCategoryNames(product.categories);
  const labels = (product.tags ?? [])
    .map((tag) => tag?.value?.trim())
    .filter((value): value is string => Boolean(value));
  const salesChannelIds = (product.sales_channels ?? [])
    .map((salesChannel) => salesChannel?.id?.trim())
    .filter((id): id is string => Boolean(id));

  return {
    id: product.id,
    status: product.status ?? null,
    sales_channel_ids: salesChannelIds,
    title: product.title ?? null,
    description: product.description ?? null,
    handle: product.handle ?? null,
    thumbnail: product.thumbnail ?? null,
    created_at: product.created_at ?? null,
    category,
    labels,
    sku: toSkus(product.variants),
    option_values: toOptionValues(product.options),
    brand: toBrands(product.categories),
    gender: toMetadataValues(product.metadata, "gender"),
    fragrance_family: toMetadataValues(product.metadata, "fragrance_family"),
    notes: toMetadataValues(product.metadata, "notes"),
    concentration: toMetadataValues(product.metadata, "concentration"),
    ...toStock(withAvailability(product.variants, availability)),
    ...toProductPricing(pricing),
  };
}

/**
 * A row that returns no document leaves
 * the index: the helpers turn it into a delete on `consume` and on the
 * catch-up pass.
 */
const source = {
  fields: PRODUCT_GRAPH_FIELDS,
  transform: async (
    rows: ProductRow[],
    context: SearchTypes.SearchIngestionContext,
  ) => {
    const [pricing, availability] = await Promise.all([
      loadPricing(
        rows.map((row) => row.id),
        context,
      ),
      loadAvailability(variantIds(rows), context),
    ]);

    return rows.map((row) =>
      toDocument(row, pricing.get(row.id), availability),
    );
  },
};

/**
 * Everything a document is built from, so a change to any of it re-indexes the
 * products it touches. Only `product.deleted` removes documents: a deleted
 * variant, option, tag or category means the product has to be re-read.
 *
 * TODO: price lists emit no events (create, update, delete, batch prices).
 * TODO: price lists crossing their start or end date change prices silently.
 * TODO: linkProductsToSalesChannelWorkflow emits nothing.
 * TODO: batchLinkProductsToCategoryWorkflow emits nothing.
 * TODO: upsertVariantPricesWorkflow emits nothing when called directly.
 * TODO: linking or unlinking an inventory item to a variant emits nothing.
 * TODO: deleting an inventory item drops its variant link, so its products
 *   cannot be found from `inventory-item.deleted`.
 * TODO: adjusting inventory through the Inventory Module directly (not a
 *   workflow) emits only the module's own `inventory.inventory-level.*`
 *   events, which are not consumed here.
 */
const PRODUCT_EVENTS = [
  "product.created",
  "product.updated",
  "product.deleted",
  "product-variant.created",
  "product-variant.updated",
  "product-variant.deleted",
  "product-option.created",
  "product-option.updated",
  "product-option.deleted",
  "product-option-value.updated",
  "product-option-value.deleted",
  "product-tag.updated",
  "product-tag.deleted",
  "product-category.updated",
  "product-category.deleted",
  "sales-channel.deleted",
  // Stock: available quantity is stocked minus reserved, so both move it.
  "inventory-level.created",
  "inventory-level.updated",
  "inventory-level.deleted",
  "reservation-item.created",
  "reservation-item.updated",
  "reservation-item.deleted",
];

export default defineSearchIndex({
  name: "product",
  entity: "product",
  primary_key: "id",
  provider: "meilisearch",
  fields: productFields,
  settings: {
    typo_tolerance: { enabled: true, disabled_on_attributes: ["sku"] },
  },
  events: PRODUCT_EVENTS,
  consume: graphConsume<typeof productFields, ProductRow>({
    ...source,
    resolve_ids: resolveProductIds,
    is_delete: (event) => event.name === "product.deleted",
  }),
  seed: graphSeed<typeof productFields, ProductRow>(source),
});
