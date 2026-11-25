# Storefront Phase 4: Product catalog design

Date: 2026-11-25. Brief: `apps/storefront/CLAUDE.md`, Phase 4. Builds on Phase 3 (homepage, merged at `11a56ac659`). Decisions below were approved with "take all recommended".

## Understanding

- **Goal:** a shareable, mobile-friendly catalog listing with the brief's filters, sorting, pagination, grid/list toggle, quick add, wishlist hearts and badges, working on real product data and never loading the whole catalog.
- **Today:** `/store` is a search-driven listing (`react-instantsearch` through `/store/search`, Medusa's built-in search framework) with sort, price range, on-sale toggle, category, tag and option-value filters, active-filter chips, numbered pagination and URL routing. The product index (`apps/backend/src/search/product.ts`) holds title, description, handle, thumbnail, created date, category names, tags, option values and per-currency prices. It has no brand, gender, fragrance family, notes, concentration, stock state or variant id. Category and collection pages use a separate server-rendered listing (`paginated-products`) that already renders `ProductCardView`. No wishlist exists. Local data is 4 demo clothing products with empty metadata.
- **Assumption:** the owner will enter fragrance attributes as product metadata and brands as categories (Phase 4a import or Admin). The UI must light up when that data exists and show nothing invented when it does not.

## Decisions

1. **Fragrance attributes come from product `metadata` keys:** `gender` (string), `fragrance_family` (string), `notes` (array of strings, or one comma-separated string), `concentration` (string). **Brand** is the name of the product's category whose parent has handle `brands` (same convention as the homepage). All five become index fields: `brand`, `gender`, `fragrance_family`, `notes`, `concentration`, each filterable, facetable and retrievable keyword arrays (single-valued ones as arrays of at most one value).
2. **Availability:** new boolean index field `in_stock` (filterable, facetable, retrievable): true when any variant can be bought, meaning `manage_inventory` is false, or `allow_backorder` is true, or its stocked quantity is above zero. A product without variants is false. A second field `single_variant_id` (keyword, retrievable) holds the variant id only when the product has exactly one variant, for quick add. The inventory events that exist in this Medusa version are added to the index event list so a stock change re-indexes the product; where no event exists the gap is documented as a `TODO` like the existing ones.
3. **A filter group renders only when its facet has values.** `RefinementGroup` already returns null for an empty facet; new groups reuse it. With demo data the visible groups are category, price, sale and availability.
4. **Sorting stays as is** (relevance, latest, price both ways, title both ways; the index already sorts on these) and is exposed in a mobile-friendly select above the grid and in the filter drawer.
5. **Where it applies:** the full filter set is on `/store`. Category and collection pages keep their server-rendered listing, and gain the grid/list toggle (server-side `?view=list` link) on the shared card.
6. **Grid/list:** `view=list` in the URL, default grid. On `/store` the param is carried through InstantSearch routing so it survives filter changes and shared links. List view is one column with a horizontal card (image left, text and actions right).
7. **Pagination** stays numbered in the URL (existing component, restyled to Phase 2 tokens if it is not already); page size 12 grid, 12 list.
8. **Mobile filters:** below `small`, a sticky "Filters" button (with the active-filter count) opens the Phase 2 `Drawer` from the left containing sort, all filter groups and "Show N results" and "Clear all". Active filters show as removable chips above the grid at every width. Desktop keeps the left column.
9. **Quick add:** a button on each card. `in_stock` false: disabled "Sold out". One variant (`single_variant_id` present): adds quantity 1 with the existing `addToCart` action and shows a Phase 2 toast ("Added to cart" or the error). Several variants: the button reads "Choose options" and links to the product page. It never blocks navigation on the card link.
10. **Badges** computed from the hit: "Sale" when the region currency's `on_sale_<cur>` is true, "New" when `created_at` is within the last 30 days, "Sold out" when `in_stock` is false. At most two badges, in the order Sold out, Sale, New, shown over the image corner.
11. **Wishlist:** a heart button per card, stored in `localStorage` key `sc-wishlist` as an array of product ids (cap 200, every storage access in try/catch). Toggling announces through `aria-pressed` and a toast. No wishlist page and no account sync in this phase (Phase 9).
12. **Images:** cards pass correct `sizes` hints; optimisation and CDN stay in Phase 7.

## Architecture

### Backend (`apps/backend/src/search`)
- `helpers/fragrance.ts` (pure, unit-tested): `toBrands(categories)`, `toMetadataValues(metadata, key)` (accepts string, comma-separated string or array; trims, collapses whitespace, drops blanks, de-duplicates case-insensitively keeping the first spelling, caps at 30 values, ignores non-string items), `toStock(variants)` returning `{ in_stock: boolean; single_variant_id: string | null }`.
- `product.ts`: extend `PRODUCT_GRAPH_FIELDS` (`metadata`, `categories.name`, `categories.parent_category.handle`, `variants.id`, `variants.manage_inventory`, `variants.allow_backorder`, and whatever the graph exposes for stocked quantity), the field schema, `toDocument`, and `PRODUCT_EVENTS`. Adding fields is a schema change, so the module reindexes on the next boot (existing comment in `helpers/pricing.ts`).
- Verification against the real index is required: the implementer queries `/store/search` on the local backend for the new fields and reports what the graph returned for stock.

### Storefront (`apps/storefront/src`)
- `lib/search-client.ts` and `modules/store/components/store-refinements/attributes.ts`: attribute constants `BRAND_ATTRIBUTE`, `GENDER_ATTRIBUTE`, `FAMILY_ATTRIBUTE`, `NOTES_ATTRIBUTE`, `IN_STOCK_ATTRIBUTE`; `ProductHit` type extended with the new retrievable fields.
- `modules/store/components/store-refinements/`: `availability-toggle.tsx` (checkbox for `in_stock:true`), new groups in `index.tsx` in brief order (Brand, Category, Gender, Fragrance family, Notes, Price, Availability, On sale), `filter-drawer.tsx` (mobile), `view-toggle.tsx` (presentational, two buttons with `aria-pressed`, also usable as links on server pages), `result-count`.
- `modules/store/components/store-hits/`: card view uses `ProductCardView` with new optional props `badges?: string[]` and `actions?: ReactNode` (actions render outside the card link so there are no nested interactive elements); `get-badges.ts` (pure), `quick-add.tsx`, `modules/wishlist/` (`wishlist-storage.ts` pure parse/serialise/toggle, `use-wishlist.ts` with `useSyncExternalStore` and the `storage` event, `wishlist-button.tsx`).
- `modules/store/templates/index.tsx`: layout with mobile filter button, chips, sort select, view toggle, hits, pagination; routing `stateMapping` carries `view`.
- Category and collection pages: `ViewToggle` as links and a list-capable `ProductPreview` layout; `searchParams.view` read server-side.

## Error handling and edge cases

- Product with no metadata, no brand category or no variants: indexes with empty arrays and `in_stock` false; never throws; never breaks reindexing of other products.
- `notes` given as `"rose, oud, rose"`, as an array with a number inside, or as an empty string: normalised per decision 1.
- A facet with hundreds of values: groups show the top 20 by count (existing behaviour) with a "Show more" control and a search box over the facet values when it has more than 20.
- Quick add on a product whose variant became unavailable between index and click: the add-to-cart error shows as an error toast; the button re-enables.
- Wishlist storage unavailable or corrupt JSON: the heart still toggles for the session (in memory), the page does not throw, a corrupt value is ignored and overwritten on the next toggle.
- `view` with an unknown value falls back to grid. Page number beyond the last page shows the empty state with a "Clear filters" link.
- Zero results: message, active chips and a "Clear all" button; no layout jump from the filter column.

## Testing

- Backend: unit tests for the three helper functions with the cases above, a test that `toDocument` output contains the new fields for a fixture product and empty values for a bare product (the existing search tests are the pattern).
- Storefront (Vitest, jsdom): `get-badges` (boundary at exactly 30 days, ordering, max two), wishlist storage (corrupt, cap, toggle), `WishlistButton` (toggle, `aria-pressed`, storage that throws), `QuickAdd` (sold out disabled, single variant calls `addToCart` once and toasts, multi-variant renders a link, error path), `ViewToggle`, availability toggle and a new group hide on empty facets, `ProductCardView` with `badges` and `actions` keeps the link free of nested buttons, filter drawer opens and clears (polyfills as in `drawer.test.tsx`).
- Verification (phase end): backend typecheck and unit tests, storefront typecheck, lint (count `Error:` lines, zero), tests, deploy tests, sibling-copy `next build` as before, secret scan, a local `/store/search` query for the new facets, and the built storefront returning 200 on `/us/store`; browser checks only if a browser tool exists.

## Out of scope

Wishlist page and account sync (Phase 9); server-rendered or crawlable `/store` results and brand pages (Phases 11 and 4 follow-ups); image optimisation and CDN (Phase 7); a search page, autocomplete and synonyms (Phase 6); filters for category and collection pages; computing "best seller"; loading real fragrance data (owner or Phase 4a import).

## Owner inputs needed (not blocking the build)

Fragrance metadata on products (`gender`, `fragrance_family`, `notes`, `concentration`), brands as child categories of `brands`, and a reindex after the backend is deployed (automatic on boot after the schema change).
