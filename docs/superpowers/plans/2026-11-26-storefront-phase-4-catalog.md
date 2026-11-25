# Storefront Phase 4: Product Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the product search index with brand, fragrance attributes and stock, and build the catalog listing (filters, mobile filter drawer, grid/list toggle, badges, quick add, wishlist hearts) on `/store`, with the grid/list toggle on category and collection pages.

**Architecture:** Pure helper functions turn product data into index fields (backend) and hits into badges and labels (storefront). The `/store` listing stays an InstantSearch page; new filter groups reuse the existing refinement components, which hide themselves when a facet is empty. Card actions render outside the card link.

**Tech Stack:** Medusa 2.x search framework (`defineSearchIndex`), Jest (backend unit tests), Next 15.5, React 19.0.5, `react-instantsearch` 7, Tailwind 3 with the Phase 2 tokens, Vitest 4 with jsdom and `src/test/render.tsx`.

**Spec:** `docs/superpowers/specs/2026-11-25-storefront-phase-4-catalog-design.md`

## Global Constraints

- Work in `apps/backend/src/search` (Tasks 1 and 2), `apps/storefront` and `docs/storefront/`. Style: no semicolons in new storefront code (backend files keep their own existing style: check the neighbouring files), double quotes in the storefront, 2-space indent, kebab-case files, no emojis (repo `AGENTS.md`). Keep an edited file's existing line endings and valid UTF-8 (`apps/storefront/src/test/encoding.test.ts` guards storefront sources).
- No mock data in production code; fixtures only in tests. Never invent fragrance values: filter groups render only when the index returns values.
- Metadata keys (exact): `gender`, `fragrance_family`, `notes`, `concentration`. Brand = name of a product category whose parent category has handle `brands`. Index field names (exact): `brand`, `gender`, `fragrance_family`, `notes`, `concentration`, `in_stock`, `single_variant_id`.
- `localStorage` key `sc-wishlist` (JSON array of product ids, cap 200). URL param `view` with values `grid` (default) and `list`. Badges: at most two, order Sold out, Sale, New; "New" means created within 30 days.
- Tailwind 3 cannot apply alpha modifiers to the CSS-variable token colours: use explicit values such as `bg-[rgb(30_29_27/0.4)]`. Client components cannot read `process.env` dynamically: pass values as props from server components.
- Phase 2 rules apply to all new UI: gold never body text (use `gold-deep`), focus ring `focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2`, touch targets at least 44px below 1024px (`min-h-[44px] lg:min-h-0`), motion only under `motion-safe:` or with `motion-reduce:transition-none`, AA text contrast, existing `data-testid` values unchanged. No `any` in storefront code or tests (lint errors fail `next build`).
- Storefront checks per task, from `apps/storefront`: `npx vitest run`, `npx tsc --noEmit`, and `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_test NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://localhost:9000 npx next lint` with the number of `Error:` lines counted by `grep -c "Error:"` (must be 0; never truncate lint output). Backend checks from `apps/backend`: the unit tests for the files touched (`npm run test:unit -- <path>`) and `npx tsc --noEmit` (or the repo's backend typecheck command; read `apps/backend/package.json`).
- Verify every commit exists with `git log -1` before reporting. Do not install packages. `next build` fails inside a worktree nested under the repo (known); it is run from a copy outside it in Task 9. Worktree `node_modules` are directory junctions already in place; never `ln -s`, never a full `yarn install`.

## Review Focus

- A product with no metadata, no variants, no brand category, or `notes` given as a number-containing array or an empty string must index without throwing and without breaking other products (Tasks 1 and 2).
- Double-clicking quick add must add once (button disabled while pending); a failing add shows an error toast and re-enables the button (Task 4).
- A facet with hundreds of values must stay usable: top 20 by count, "Show more", and a search box over its values when it has more than 20 (Task 5).
- Wishlist `localStorage` that throws or holds corrupt JSON must not break the card; the heart still toggles for the session (Tasks 3 and 4).
- `view` must survive filter changes and shared links, an unknown value falls back to grid, and a page beyond the last page shows the empty state with a way to clear filters (Task 6).

---

### Task 1: Backend index helpers

**Files:**
- Create: `apps/backend/src/search/helpers/fragrance.ts`, `apps/backend/src/search/helpers/__tests__/fragrance.unit.spec.ts`

**Interfaces:**
- Produces: `toBrands(categories: ({ name?: string | null; parent_category?: { handle?: string | null } | null } | null)[] | null | undefined): string[]` (names, trimmed, of categories whose `parent_category.handle` is `"brands"`; de-duplicated case-insensitively keeping the first spelling); `toMetadataValues(metadata: Record<string, unknown> | null | undefined, key: string): string[]` (accepts a string, a comma-separated string, or an array; non-string items ignored; each value trimmed with inner whitespace collapsed; blanks dropped; de-duplicated case-insensitively keeping the first spelling; at most 30 values); `toStock(variants: ({ id?: string | null; manage_inventory?: boolean | null; allow_backorder?: boolean | null; inventory_quantity?: number | null } | null)[] | null | undefined): { in_stock: boolean; single_variant_id: string | null }` (in stock when any variant has `manage_inventory === false`, or `allow_backorder === true`, or `inventory_quantity` greater than 0; no variants gives `in_stock: false`; `single_variant_id` is the id only when exactly one variant with an id exists, else `null`).

- [ ] **Step 1: Write the unit tests** (Jest, same style as the neighbouring `*.unit.spec.ts` files): `toBrands` keeps only brand children, ignores null entries and categories with other parents, de-duplicates `"Dior"` and `"dior"`; `toMetadataValues` for `"rose, oud, rose"` gives `["rose","oud"]`, for `["Rose", 5, " Oud ", ""]` gives `["Rose","Oud"]`, for `""`, `null`, a number and a missing key gives `[]`, and truncates 40 distinct values to 30; `toStock`: no variants, one untracked variant, one tracked with 0 and `allow_backorder` false (false), one tracked with 3 (true), two variants (single id null), a variant without id.
- [ ] **Step 2: Run, expect FAIL** (`npm run test:unit -- apps/backend/src/search/helpers` from the right directory; read how the repo runs a single unit spec).
- [ ] **Step 3: Implement** `fragrance.ts` per Interfaces (pure functions, no imports from Medusa).
- [ ] **Step 4: Run tests, backend typecheck; commit** `feat(search): fragrance and stock index helpers`.

### Task 2: Wire the index fields

**Files:**
- Modify: `apps/backend/src/search/product.ts`
- Create: `apps/backend/src/search/__tests__/product-document.unit.spec.ts` (only if `toDocument` can be exercised; export it for tests if needed, as a named export)

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: index fields `brand`, `gender`, `fragrance_family`, `notes`, `concentration` (each `search.keyword().array().filterable().facetable().retrievable()`), `in_stock` (`search.boolean().filterable().facetable().retrievable()`), `single_variant_id` (`search.keyword().retrievable()`); `toDocument` fills them using `toBrands(product.categories)`, `toMetadataValues(product.metadata, ...)` for the four metadata keys, and `toStock(product.variants)`; `PRODUCT_GRAPH_FIELDS` gains `metadata`, `categories.parent_category.handle`, `variants.id`, `variants.manage_inventory`, `variants.allow_backorder`, and whatever the graph can supply for stocked quantity (try `variants.inventory_quantity` and the inventory item levels; use the lowest-effort field that returns a real number on the local backend); `PRODUCT_EVENTS` gains the inventory events that exist in this Medusa version (find the exact names in `@medusajs/framework` / the inventory module events and in `apps/backend/src/subscribers/channel-stock-trim.ts`); any stock change that cannot be observed gets a `TODO` line beside the existing ones.

- [ ] **Step 1: Write the test** that `toDocument` (exported) returns the seven new fields for a fixture product (brand category under `brands`, metadata with all four keys, two variants one in stock) and empty arrays, `in_stock: false` and `single_variant_id: null` for a bare product (no categories, no metadata, no variants).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the schema, document mapping, graph fields and events. Then verify against the real backend: restart or reindex the local backend if it is running (read `apps/backend/package.json` and the repo docs for how; do not wipe data), then POST to `http://localhost:9000/store/search` with the storefront publishable key (read it from the main checkout's `apps/storefront/.env` into a shell variable, never print it) requesting facets for `in_stock` and the new fields; report what the stock source returned for the four demo products and whether `brand` and the metadata facets are accepted. If the dev backend cannot be reindexed from here, say so plainly and rely on the unit tests.
- [ ] **Step 4: Run backend unit tests and typecheck; commit** `feat(search): index brand, fragrance attributes and stock`.

### Task 3: Storefront pure helpers and the card slots

**Files:**
- Create: `apps/storefront/src/modules/store/types.ts`, `apps/storefront/src/modules/store/components/store-hits/get-badges.ts`, `apps/storefront/src/modules/store/components/store-hits/get-badges.test.ts`, `apps/storefront/src/modules/wishlist/wishlist-storage.ts`, `apps/storefront/src/modules/wishlist/wishlist-storage.test.ts`
- Modify: `apps/storefront/src/modules/products/components/product-preview/index.tsx` (`ProductCardView` only), `apps/storefront/src/modules/products/components/product-preview/product-card.test.tsx`, `apps/storefront/src/lib/search-client.ts` (add attribute constants), `apps/storefront/src/modules/store/components/store-refinements/attributes.ts`

**Interfaces:**
- Produces: in `types.ts`, `type CatalogHit = Hit<{ title: string | null; handle: string | null; thumbnail: string | null; created_at?: string | null; in_stock?: boolean | null; single_variant_id?: string | null; brand?: string[] } & HitPricing>` (import `HitPricing` from the existing `store-hits/price`); in `attributes.ts`, `BRAND_ATTRIBUTE = "brand"`, `GENDER_ATTRIBUTE = "gender"`, `FAMILY_ATTRIBUTE = "fragrance_family"`, `NOTES_ATTRIBUTE = "notes"`, `IN_STOCK_ATTRIBUTE = "in_stock"`; `getBadges(hit: { created_at?: string | null; in_stock?: boolean | null } & HitPricing, currencyCode: string, now?: Date): string[]` returning at most two of `"Sold out"`, `"Sale"`, `"New"` in that order (Sale when `on_sale_<cur>` for the region currency is true, via `priceAttribute`; Sold out only when `in_stock === false`, so a hit without the field is not flagged; New when `created_at` is within 30 days and not in the future); wishlist storage: `WISHLIST_KEY = "sc-wishlist"`, `parseWishlist(raw: string | null): string[]` (corrupt or non-array JSON gives `[]`, non-strings dropped, de-duplicated, cap 200 keeping the newest), `toggleWishlist(ids: string[], id: string): string[]` (adds to the end or removes; cap 200 dropping the oldest), `serializeWishlist(ids: string[]): string`; `ProductCardView` gains optional `badges?: string[]` (rendered over the image corner as small paper pills with charcoal text) and `actions?: ReactNode` (rendered as a sibling after the card link, absolutely positioned over the image corner for the heart and below the text for quick add: provide two named wrappers or one slot as you judge, but the card link must not contain any `button`), and a `layout?: "grid" | "list"` prop (list: image left at about 40% width, text and actions right; grid is the current look). Existing props, testids and the card's current look in grid mode stay unchanged.

- [ ] **Step 1: Write the tests**: `getBadges` (Sold out and Sale and New gives the first two; `in_stock` undefined gives no Sold out; exactly 30 days old still New, 31 days not; future date not New; wrong-currency sale ignored), wishlist storage (corrupt JSON, object instead of array, mixed types, duplicates, 205 ids capped at 200, toggle add and remove), `ProductCardView` with `badges` shows them, with `actions` renders them outside the `a`, the `a` contains no `button`, `layout="list"` changes the wrapper class, defaults unchanged.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run tests, typecheck, lint; commit** `feat(storefront): catalog helpers and card slots`.

### Task 4: Wishlist heart and quick add

**Files:**
- Create under `apps/storefront/src/modules/`: `wishlist/use-wishlist.ts`, `wishlist/wishlist-button.tsx`, `wishlist/wishlist-button.test.tsx`, `store/components/store-hits/quick-add.tsx`, `store/components/store-hits/quick-add.test.tsx`

**Interfaces:**
- Consumes: Task 3 storage helpers and `CatalogHit`; `addToCart({ variantId, quantity, countryCode })` from `@lib/data/cart`; `useToast` from `@modules/common/components/toast`; `useParams` from `next/navigation` for `countryCode`.
- Produces: `useWishlist(): { ids: string[]; has: (id: string) => boolean; toggle: (id: string) => void }` (client hook using `useSyncExternalStore` on a module-level store that reads `localStorage` lazily, listens to the `storage` event, writes inside try/catch, and falls back to an in-memory list when storage throws); `WishlistButton({ productId, title }: { productId: string; title: string })` (a 44px icon button, `aria-pressed`, `aria-label` "Add <title> to wishlist" or "Remove <title> from wishlist", toasts "Added to wishlist" or "Removed from wishlist", gold-deep filled heart when saved, inline SVG so no icon library is needed); `QuickAdd({ productId, title, inStock, singleVariantId, href }: { productId: string; title: string; inStock: boolean | null | undefined; singleVariantId: string | null | undefined; href: string })`: `inStock === false` renders a disabled "Sold out" button; with `singleVariantId` renders an "Add to cart" button that calls `addToCart` once with quantity 1, is disabled while pending, toasts "Added to cart" on success and an error toast (`tone: "error"`, the error message when it is an `Error`, else "Couldn't add to cart") on failure then re-enables; otherwise renders a `LocalizedClientLink` button-styled "Choose options" to `href`. After a successful add call `router.refresh()` so the cart count updates.

- [ ] **Step 1: Write the tests** (jsdom; mock `@lib/data/cart` and `next/navigation`; wrap in `ToastProvider`): heart toggles `aria-pressed`, persists to `localStorage` (assert the stored JSON), reads an existing value on mount, with a `localStorage` whose `getItem` and `setItem` throw still toggles and does not throw, with corrupt JSON starts empty; QuickAdd sold out is disabled and never calls `addToCart`, single variant calls `addToCart` once with `{ variantId, quantity: 1, countryCode }` even when clicked twice quickly (second click ignored while pending), shows a success toast, rejection shows an error toast and re-enables, multi-variant renders a link with the given `href` and no button.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run tests, typecheck, lint; commit** `feat(storefront): wishlist heart and quick add`.

### Task 5: Filter groups

**Files:**
- Create: `apps/storefront/src/modules/store/components/store-refinements/availability-toggle.tsx`, `apps/storefront/src/modules/store/components/store-refinements/refinement-group.test.tsx`, `apps/storefront/src/modules/store/components/store-refinements/availability-toggle.test.tsx`
- Modify: `apps/storefront/src/modules/store/components/store-refinements/refinement-group.tsx`, `store-refinements/index.tsx`, `store-refinements/current-refinements.tsx` (labels for the new attributes)

**Interfaces:**
- Consumes: Task 3 attribute constants.
- Produces: `RefinementGroup({ attribute, title })` gains "Show more" (toggles from 20 to the hook's `showMore` limit, e.g. `limit: 20, showMore: true, showMoreLimit: 200`) and a text search box over the facet values (`searchable` via `searchForItems`) shown only when the facet reports more than 20 values; behaviour for small facets and the `data-testid="refinement-<attribute>"` on checkboxes are unchanged. `AvailabilityToggle` (same pattern as `OnSaleToggle`: `useToggleRefinement({ attribute: IN_STOCK_ATTRIBUTE, on: true })`, label "In stock only", hidden when it cannot refine, `data-testid="in-stock-toggle"`). `StoreRefinements` renders, in this order: sort, active chips, Brand, Category, Gender, Fragrance family, Notes, price range, availability toggle, on-sale toggle, then the existing option refinements and Labels group; `CurrentRefinements` shows readable labels for the new attributes (Brand, Gender, Fragrance family, Note, In stock) and removes them on click.

- [ ] **Step 1: Write the tests** (jsdom, with a mocked `react-instantsearch` hook module): a group with 3 items shows no search box and no "Show more"; a group with 45 items shows 20, a "Show more" control, and a search box whose input calls `searchForItems`; an empty group renders nothing; `AvailabilityToggle` renders nothing when `canRefine` is false and calls `refine` when toggled.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** per Interfaces; keep the 250px desktop column unchanged.
- [ ] **Step 4: Run tests, typecheck, lint; commit** `feat(storefront): brand, fragrance and availability filters`.

### Task 6: Store listing: mobile filters, view toggle, cards, empty states

**Files:**
- Create: `apps/storefront/src/modules/store/components/view-toggle/index.tsx`, `view-toggle/view-toggle.test.tsx`, `apps/storefront/src/modules/store/components/store-refinements/filter-drawer.tsx`, `store-refinements/filter-drawer.test.tsx`, `apps/storefront/src/modules/store/components/store-hits/catalog-card.tsx`, `store-hits/catalog-card.test.tsx`, `apps/storefront/src/modules/store/components/store-hits/view-state.ts`, `store-hits/view-state.test.ts`
- Modify: `apps/storefront/src/modules/store/templates/index.tsx`, `store-hits/index.tsx`, `store-hits/pagination.tsx` (only if it needs Phase 2 tokens), `store-refinements/index.tsx` (desktop-only wrapper)

**Interfaces:**
- Consumes: Tasks 3 to 5.
- Produces: `parseView(value: unknown): "grid" | "list"` (anything but `"list"` gives `"grid"`) in `view-state.ts`; `ViewToggle({ view, onChange?, hrefFor? }: { view: "grid" | "list"; onChange?: (v: "grid" | "list") => void; hrefFor?: (v: "grid" | "list") => string })` (two 44px icon buttons or links labelled "Grid view" and "List view" with `aria-pressed` or `aria-current`; with `hrefFor` they render links, with `onChange` buttons); `CatalogCard({ hit, currencyCode, view }: { hit: CatalogHit; currencyCode: string; view: "grid" | "list" })` composing `ProductCardView` with `badges={getBadges(...)}`, `layout={view}`, and `actions` containing `WishlistButton` and `QuickAdd`; `FilterDrawer({ currencyCode }: { currencyCode: string })` (client; below `small` a sticky `Filters (n)` button where `n` is the number of active refinements from `useCurrentRefinements`; opens the Phase 2 `Drawer` from the left titled "Filters" containing sort, `StoreRefinements` groups, and a footer with "Show N results" (closes the drawer; `N` from `useInstantSearch` results `nbHits`) and "Clear all" (`useClearRefinements`)); the desktop column shows from `small` up and is hidden below; the template renders sort as a compact select above the grid at every width plus `ResultCount`, `CurrentRefinements` chips above the grid, `ViewToggle`, hits and pagination. The `view` param is carried through InstantSearch routing (`routing.stateMapping` with `stateToRoute` and `routeToState` preserving `view`, default omitted from the URL) so it survives filter changes and a reload; the hits grid classes switch between the current 2/3/4 column grid and a single column in list view. Empty state: text "No products matched these filters." plus a "Clear all" button (same hook), also shown when the requested page is beyond the last page (hits empty while `nbHits` greater than 0 or while a `page` refinement is set).

- [ ] **Step 1: Write the tests**: `parseView` (undefined, "grid", "list", "LIST", "x"); `ViewToggle` both modes, `aria-pressed` or `aria-current` reflects the view, `onChange` called with the other value; `CatalogCard` renders badges, the heart and quick add outside the link, passes `single_variant_id` and `in_stock` through, grid vs list layout class; `FilterDrawer` (mock the instantsearch hooks; jsdom polyfills as in `drawer.test.tsx`) shows the count on the button, opens the drawer, "Clear all" calls `clearRefinements`, "Show N results" closes it; a state-mapping test for `view` (route from state and state from route, default omitted, invalid value dropped).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** per Interfaces. Pagination: confirm it works with `view` in the URL and that its links keep other params (InstantSearch routing handles this); fix tokens only if it still uses old preset greys.
- [ ] **Step 4: Run tests, typecheck, lint; commit** `feat(storefront): catalog listing with mobile filters and view toggle`.

### Task 7: Category and collection pages

**Files:**
- Modify: `apps/storefront/src/modules/products/templates/` and `apps/storefront/src/modules/store/templates/paginated-products.tsx` (read both; whichever renders the grid for `/categories/...` and `/collections/...`), `apps/storefront/src/app/[countryCode]/(main)/categories/[...category]/page.tsx`, `apps/storefront/src/app/[countryCode]/(main)/collections/[handle]/page.tsx`
- Create: a test for the server-side helper that decides the grid classes and the toggle hrefs

**Interfaces:**
- Consumes: `parseView`, `ViewToggle` (links mode), `ProductCardView` `layout` prop.
- Produces: both pages read `searchParams.view` (Next 15: `searchParams` is a Promise), pass `view` to the listing, render `ViewToggle` with `hrefFor` building the same path plus the existing params with `view` set (omitted for grid), and render each product with `layout={view}` (list view one column). Sort and pagination links on these pages keep `view`.

- [ ] **Step 1: Write the test** for the pure helper (`gridClasses(view)` and `viewHref(pathname, params, view)`): grid omits `view`, list sets `view=list`, existing `sortBy` and `page` kept, an unknown `view` falls back to grid.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run tests, typecheck, lint; commit** `feat(storefront): view toggle on category and collection pages`.

### Task 8: Documentation

**Files:**
- Create: `docs/storefront/CATALOG.md`

**Interfaces:**
- Produces: a doc covering: what the catalog shows and where; the owner setup (metadata keys and accepted shapes with examples, brand categories under `brands`, how stock is determined, reindex on deploy and what to check); every URL parameter (`sortBy` or the InstantSearch sort state as actually implemented, `page`, `view`, refinement params) with an example shareable URL; filter groups and when each hides; badges rules; quick add rules; wishlist storage and its limits (this browser only; account sync and the wishlist page are Phase 9); failure behaviour; what is deliberately not done (server-rendered `/store`, brand pages, search page, image optimisation). Plain and factual; describe only what is built (read the code first). End with `## Verification results` and the line `Filled in during phase verification.`

- [ ] **Step 1: Write the doc. Step 2:** `npx vitest run src/test/encoding.test.ts`. **Step 3: Commit** `docs(storefront): catalog guide`.

### Task 9: Whole-phase verification

**Files:**
- Modify: `docs/storefront/CATALOG.md` (results section); fixes only otherwise, one commit per fix

- [ ] **Step 1:** In `apps/storefront`: `npx tsc --noEmit` (0), `npx next lint` (0 `Error:` lines), `npx vitest run` (all pass). In `apps/backend`: the unit specs under `src/search` and the backend typecheck. From the repo root `node --test deploy/*.test.mjs` (all pass).
- [ ] **Step 2:** Copy `apps/storefront` (excluding `node_modules`, `.next`) to `apps/sf-buildtest` in the main checkout (outside the worktree), rename its package to `@dtc/sf-buildtest` writing `package.json` without a BOM, junction its `node_modules` to the main checkout's `apps/storefront/node_modules`, and build with the real local publishable key from the main checkout's `apps/storefront/.env` (never print it) plus `NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://localhost:9000 NEXT_PUBLIC_DEFAULT_REGION=us NEXT_PUBLIC_BASE_URL=http://localhost:8002 NEXT_PUBLIC_STORE_NAME="Maison Test"`. Expect exit 0.
- [ ] **Step 3:** Scan `.next/static` for `sk_live`, `sk_test`, `whsec_` (none). Run `node .next/standalone/apps/sf-buildtest/server.js` with `PORT=8002 HOSTNAME=localhost`; `/us/store`, `/us/store?view=list`, `/us/categories/<an existing demo category handle>` and `/us/categories/<handle>?view=list` return 200; the `/us/store` HTML contains no "Medusa Store".
- [ ] **Step 4:** Query the local `/store/search` for the new facets (Task 2 results may already cover it) and record exactly what was and was not possible. Stop the server (kill by port 8002 and any `sf-buildtest` node process), `cd` out of the copy, delete the junction with `[System.IO.Directory]::Delete`, then remove the copy; confirm `apps/storefront/node_modules` still exists.
- [ ] **Step 5:** Browser checks at 390px and 1280px (filter drawer, quick add, hearts, list view) only if a browser tool is available; otherwise write that plainly. Append exact counts and what was not checked to the results section of `docs/storefront/CATALOG.md`; commit `docs(storefront): phase 4 verification`.
