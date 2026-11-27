# Storefront Phase 5: Product Detail Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A product page that sells a fragrance on the real single-variant Perfume Center records: fragrance profile, specs, quantity, Buy now, public approved reviews with a signed-in submit form, related and recently viewed products, dynamic SEO with JSON-LD.

**Architecture:** One new public backend route (`GET /store/products/:id/reviews`, read-only, query graph, pure mapping helpers). Everything else is storefront: pure helpers (profile, recently viewed, JSON-LD) with tests, small client components, and wiring in the existing product template and page. Existing `ProductActions`, `ProductPrice`, `addToCart`, `listProducts`, toast and `LocalizedClientLink` are reused, not duplicated.

**Tech Stack:** Medusa v2 (backend `apps/backend`), Next 15.5 / React 19, Tailwind 3 with Phase 2 tokens, Vitest + jsdom (storefront), Jest (backend unit).

**Spec:** `docs/superpowers/specs/2026-11-27-storefront-phase-5-product-detail-design.md`

## Global Constraints

- Paths: storefront code in `apps/storefront/src`, backend in `apps/backend/src`.
- Storefront checks run from `apps/storefront`: `npx vitest run`, `npx tsc --noEmit`, and `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_test NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://localhost:9000 npx next lint`; count output lines containing `Error:` (must be 0; no `any`; never truncate lint output).
- Backend unit tests run from `apps/backend`: `TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand --forceExit <path>` (`npm run test:unit` fails on Windows).
- Phase 2 tokens only in new code (ivory, paper, charcoal, warm-grey, line, line-strong, gold, gold-deep; see `docs/storefront/DESIGN_SYSTEM.md`). Tailwind 3 cannot apply alpha to CSS-var colours; use `bg-[rgb(30_29_27/0.4)]` style.
- Client components never read `process.env` dynamically; pass values down from server components.
- Server-action errors are masked in production: any user-facing error toast uses the fixed text "Couldn't add to cart".
- Every `localStorage` access in try/catch; the page must render with storage unavailable.
- Zod only from `@medusajs/framework/zod` (backend). Medusa routes: GET/POST/DELETE only.
- Every section renders only when it has data; nothing invented. Metadata keys: `gender`, `fragrance_family`, `concentration`, `top_notes`, `middle_notes`, `base_notes`.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never use `ln -s` (Windows). Never run `next build` inside the worktree.

## Review Focus

- Product with no metadata, no brand, no images, no description, no variants: page renders, no throw. Tests in Tasks 2, 5, 7.
- `notes` as `"rose, oud, rose"`, array containing a number, empty string: normalised. Task 2.
- Title or description containing `</script>` or `<`: JSON-LD cannot break out. Task 2.
- Reviews route returns email/ids or pending/rejected reviews: must never. Task 1.
- Review submit failing or signed out: typed text kept, clear message. Task 3.
- Recently-viewed storage corrupt or unavailable: ignored, no throw. Task 2 and 6.

---

### Task 1: Public reviews route (backend)

**Files:**
- Create: `apps/backend/src/api/store/products/[id]/reviews/route.ts`, `apps/backend/src/api/store/products/[id]/reviews/helpers.ts`
- Modify: `apps/backend/src/api/middlewares.ts` (add a GET route entry for query validation if needed; look at how `/store/reviews*` is registered at lines ~37-40 and do not put `authenticate` on the new route)
- Test: `apps/backend/src/api/store/products/[id]/reviews/__tests__/helpers.unit.spec.ts` and `route.unit.spec.ts` (follow `apps/backend/src/api/admin/reviews/__tests__` for style)

**Interfaces:**
- Produces (`helpers.ts`):
  - `type PublicReview = { id: string; rating: number; title: string; comment: string; created_at: string; author: string }`
  - `toPublicReview(row: { id: string; rating: number; title: string; comment: string; created_at: string | Date; customer?: { first_name?: string | null } | null }): PublicReview`: `author` is the trimmed first name or `"Customer"`; no email, no ids other than the review id; `created_at` as ISO string.
  - `toAverage(ratings: number[]): number | null`: mean rounded to one decimal, `null` for empty.
  - `clampLimit(raw: unknown): number` (default 10, min 1, max 50) and `clampOffset(raw: unknown): number` (default 0, min 0).
- Produces (route): `GET /store/products/:id/reviews?limit&offset` returns `{ reviews: PublicReview[]; count: number; average: number | null; limit: number; offset: number }`. Only `status: "approved"` rows. `count` and `average` cover all approved reviews of the product, not just the page. Newest first. Header `Cache-Control: public, max-age=60`.

- [ ] **Step 1: Write failing tests.** Helpers: `toPublicReview` with first name, blank first name, null customer (author "Customer"), no email key in the output, Date input to ISO; `toAverage([])` null, `[5,4]` 4.5, `[5,5,4]` 4.7; `clampLimit` of undefined, "0", "999", "abc", "7"; `clampOffset` of "-3", "abc". Route (mock `req.scope.resolve` query graph): filters contain `product_id` and `status: "approved"`, a pending row returned by a faulty mock is not exposed because the filter is passed to the graph (assert the filter), count/average computed from the full approved set.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** helpers and `GET` using `ContainerRegistrationKeys.QUERY` and `query.graph({ entity: "review", fields: [id, rating, title, comment, created_at, customer.first_name], filters: { product_id, status: "approved" }, pagination: { take, skip, order: { created_at: "DESC" } } })`. For `average` and `count` run a second graph over the same filter with `fields: ["rating"]` and no pagination. Product id comes from `req.params.id`.
- [ ] **Step 4: Run backend jest on the new tests and on `src/api/admin/reviews`; run backend `npx tsc --noEmit` and confirm no new errors outside `integration-tests`. Commit** `feat(backend): public approved reviews route`.

---

### Task 2: Pure storefront helpers

**Files:**
- Create: `apps/storefront/src/lib/util/fragrance-profile.ts`, `apps/storefront/src/lib/util/recently-viewed.ts`, `apps/storefront/src/lib/util/product-seo.ts`
- Test: `fragrance-profile.test.ts`, `recently-viewed.test.ts`, `product-seo.test.ts` next to each

**Interfaces:**
- Produces:
  - `fragrance-profile.ts`: `toNoteList(value: unknown): string[]` (string, comma-separated string or array; trim, collapse whitespace, drop blanks and non-strings, de-duplicate case-insensitively keeping first spelling, cap 30); `toBrandName(product: { categories?: Array<{ name?: string | null; parent_category?: { handle?: string | null } | null } | null> | null }): string | null` (first category whose parent handle is `brands`); `toFragranceProfile(product: { metadata?: Record<string, unknown> | null }): FragranceProfile` where `type FragranceProfile = { family: string | null; gender: string | null; concentration: string | null; top: string[]; middle: string[]; base: string[]; isEmpty: boolean }` (string fields trimmed, blank becomes null).
  - `recently-viewed.ts`: `RECENT_KEY = "sc-recently-viewed"`, `RECENT_CAP = 12`; `parseRecent(raw: string | null): string[]` (invalid JSON or non-array yields `[]`, non-strings dropped); `addRecent(list: string[], id: string): string[]` (id first, de-duplicated, capped); `readRecent(): string[]`, `writeRecent(list: string[]): void` (both try/catch).
  - `product-seo.ts`: `buildDescription(input: { brand: string | null; family: string | null; description: string | null | undefined; title: string }): string` (max 160 characters, never empty: falls back to the title); `buildProductJsonLd(input: { name: string; url: string; images: string[]; description: string; sku: string | null; brand: string | null; price: number | null; currency: string | null; inStock: boolean; rating: { average: number; count: number } | null; reviews: Array<{ author: string; rating: number; title: string; comment: string; created_at: string }> }): Record<string, unknown>` (omits `offers` when no price, `aggregateRating` and `review` when no rating, max 5 reviews); `serializeJsonLd(data: Record<string, unknown>): string` (JSON.stringify with `<` replaced by `<`).

- [ ] **Step 1: Write failing tests** covering every behaviour above: notes forms from the spec (`"rose, oud, rose"` gives `["rose","oud"]`, array with a number, empty string, 40 values capped at 30), brand from nested parent, no brand, profile `isEmpty` true for `{}` and `null`; recent parse (corrupt, `{}`, mixed array), add (dedupe moves to front, cap 12), read/write with a throwing `localStorage` (use `vi.spyOn(Storage.prototype, ...)`); description truncation at 160 and fallback; JSON-LD omits offers/rating, includes max 5 reviews, `serializeJsonLd` of a title `</script><b>` contains no `<`.
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement. Step 4: Run vitest on the three files, tsc, lint. Commit** `feat(storefront): fragrance profile, recently viewed and SEO helpers`.

---

### Task 3: Reviews data layer and components

**Files:**
- Create: `apps/storefront/src/lib/data/reviews.ts`, `apps/storefront/src/modules/products/components/reviews/{review-summary,review-list,review-form,index}.tsx` (`index.tsx` is the async server section `ProductReviews`)
- Test: `review-summary.test.tsx`, `review-list.test.tsx`, `review-form.test.tsx` in the same folder

**Interfaces:**
- Consumes: Task 1 route shape `{ reviews, count, average, limit, offset }`; `retrieveCustomer` from `@lib/data/customer`; `sdk` from `@lib/config`; `getAuthHeaders` from `@lib/data/cookies`; `useToast` from `@modules/common/components/toast`.
- Produces:
  - `lib/data/reviews.ts`: `type ReviewsPage = { reviews: PublicReviewDto[]; count: number; average: number | null }` (`PublicReviewDto` mirrors `PublicReview`), `listReviews(productId: string, offset?: number): Promise<ReviewsPage | null>` (server, returns `null` on any failure, never throws); `createReview(input: { productId: string; rating: number; title: string; comment: string }): Promise<{ ok: true } | { ok: false; error: string }>` (`"use server"` action, POSTs `/store/reviews` with the auth headers, returns a fixed `error` text, never throws). Put the `"use server"` actions and the plain `listReviews` in separate files if a mixed file is not allowed: `reviews.ts` (server data) and `review-actions.ts` (`"use server"`).
  - `ReviewSummary({ average, count }: { average: number | null; count: number })`: renders nothing when `count` is 0; else stars (accessible text "4.5 out of 5, 12 reviews").
  - `ReviewList({ productId, initial }: { productId: string; initial: ReviewsPage })`: client; shows reviews, "Load more" fetching the next page through a `loadMore(productId, offset)` server action, hidden when all loaded.
  - `ReviewForm({ productId, signedIn }: { productId: string; signedIn: boolean })`: client; guests see "Sign in to write a review" linking to `/account`; signed-in users get rating (1-5 radio group, required), title (max 100) and comment (max 2000) fields; on success shows "Thanks, your review is awaiting approval" and clears; on failure shows the returned error inline and keeps the typed values.
  - `ProductReviews({ productId }: { productId: string })`: async server component; fetches page 1 and the customer; on `null` shows "Reviews are unavailable right now"; wraps `ReviewSummary`, `ReviewList`, `ReviewForm`.

- [ ] **Step 1: Write failing tests** for `ReviewSummary` (hidden at 0, accessible text), `ReviewList` (renders author/title/comment, "Load more" calls the action and appends, hidden when `reviews.length >= count`), `ReviewForm` (guest state with link; validation blocks submit without rating/title/comment; success message; failure keeps text and shows error; submit disabled while pending).
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement** with Phase 2 tokens. **Step 4: Run vitest, tsc, lint. Commit** `feat(storefront): product reviews section`.

---

### Task 4: Purchase panel (quantity, Buy now, SKU and availability)

**Files:**
- Create: `apps/storefront/src/modules/products/components/product-actions/{quantity-selector,buy-now-button}.tsx`, tests `quantity-selector.test.tsx`, `buy-now-button.test.tsx`; `apps/storefront/src/lib/util/variant-stock.ts` (+ test)
- Modify: `apps/storefront/src/modules/products/components/product-actions/index.tsx` (and `mobile-actions.tsx` only as needed so it keeps compiling and uses the chosen quantity)

**Interfaces:**
- Produces:
  - `variant-stock.ts`: `type Availability = { state: "in_stock" | "backorder" | "out_of_stock"; max: number | null }`; `getAvailability(variant: Pick<HttpTypes.StoreProductVariant, "manage_inventory" | "allow_backorder" | "inventory_quantity"> | undefined): Availability` (untracked: in_stock with `max` null; backorder allowed: backorder, `max` null; tracked with quantity > 0: in_stock, `max` the quantity; otherwise out_of_stock, `max` 0). `availabilityLabel(a: Availability): string` ("In stock", "Available to order", "Out of stock"). The existing `inStock` logic in `ProductActions` is replaced by this.
  - `QuantitySelector({ value, onChange, max }: { value: number; onChange: (n: number) => void; max: number | null })`: minus/plus buttons with accessible names ("Decrease quantity", "Increase quantity") and a numeric input; clamps to 1 and `min(10, max ?? 10)`.
  - `BuyNowButton({ variantId, quantity, disabled }: { variantId: string | undefined; quantity: number; disabled: boolean })`: client; on click calls `addToCart({ variantId, quantity, countryCode })` (countryCode from `useParams`), then `router.push(\`/${countryCode}/checkout\`)`; on error shows toast "Couldn't add to cart" and does not navigate; loading state.
  - `ProductActions` gains: quantity state passed to Add to cart (existing behaviour with `quantity` instead of 1) and to Buy now, the availability label under the price, the variant SKU line ("SKU: AI0079777") when the selected variant has one, the quantity selector, and the Buy now button as a secondary action. Add to cart failure shows the same fixed-text toast.

- [ ] **Step 1: Write failing tests**: `getAvailability` (four states and `undefined`), `QuantitySelector` (clamp at 1, at 10, at `max` 3, typing "abc"), `BuyNowButton` (calls `addToCart` once with the quantity, then pushes to checkout; on rejection toasts the fixed text and does not push; disabled when `variantId` is undefined). Mock `next/navigation`, `@lib/data/cart` and the toast hook as in `quick-add.test.tsx`.
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement and wire into `ProductActions`. Step 4: Run vitest (whole suite, existing product-actions tests must still pass), tsc, lint. Commit** `feat(storefront): quantity selector, buy now and availability on product page`.

---

### Task 5: Header, fragrance profile, specifications, shipping, gallery

**Files:**
- Create: `apps/storefront/src/modules/products/components/fragrance-profile/index.tsx`, `apps/storefront/src/modules/products/components/product-specs/index.tsx` and tests for both
- Modify: `apps/storefront/src/modules/products/templates/product-info/index.tsx` (brand link, title, review summary slot, description), `apps/storefront/src/modules/products/components/product-tabs/index.tsx` (rebuilt: Specifications from `ProductSpecs`, Shipping and returns from the notes), `apps/storefront/src/modules/products/components/image-gallery/index.tsx` (`sizes` hint, alt text from the product title), `apps/storefront/src/lib/data/products.ts` (only if the fields below are missing from the default `fields` of `listProducts`)

**Interfaces:**
- Consumes: `toFragranceProfile`, `toBrandName` (Task 2).
- Produces:
  - `FragranceProfileSection({ profile }: { profile: FragranceProfile })`: returns `null` when `profile.isEmpty`; else a definition list with only the present rows (Family, Gender, Concentration) and note groups "Top notes", "Middle notes", "Base notes" as chip lists.
  - `ProductSpecs({ product }: { product: HttpTypes.StoreProduct })`: rows country of origin, barcode (first variant), weight, dimensions (length x width x height), material, type; only rows with values; returns `null` when none.
  - `ProductInfo` accepts `{ product, brand: string | null, brandHref: string | null, summary?: ReactNode }` and renders brand (link when `brandHref`), title (`data-testid="product-title"`), `summary`, description.
  - `ProductTabs` accepts `{ product, shippingNote?: string, returnsNote?: string }`: accordion items "Specifications" (omitted when `ProductSpecs` is empty) and "Shipping and returns" (omitted when both notes are blank). The notes come from the server (Task 7).
  - Gallery: `sizes="(min-width: 1024px) 50vw, 100vw"`, `alt` `${product.title} image ${n}`; gallery receives `title: string`.
- Verify `listProducts` requests `*variants`, `metadata`, `*categories` with `categories.parent_category` handle, `+variants.inventory_quantity`, barcode and SKU fields; read the `fields` string in `lib/data/products.ts` and add only what is missing (single edit, note it in the report).

- [ ] **Step 1: Write failing tests**: profile hidden when empty, shows only present rows and notes groups; specs hide empty rows and hide entirely; tabs omit empty items; info shows brand link only with href; gallery uses the title in alt.
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement. Step 4: Run vitest, tsc, lint. Commit** `feat(storefront): product header, fragrance profile and specifications`.

---

### Task 6: Related and recently viewed products

**Files:**
- Modify: `apps/storefront/src/modules/products/components/related-products/index.tsx`
- Create: `apps/storefront/src/modules/products/components/recently-viewed/index.tsx` (client, `RecentlyViewed({ productId, countryCode })`) and `apps/storefront/src/lib/data/recent-products.ts` (`"use server"`, `listProductsByIds(ids: string[], countryCode: string): Promise<HttpTypes.StoreProduct[]>`, order preserved, empty on failure), tests `related-query.test.ts` (pure helper) and `recently-viewed.test.tsx`

**Interfaces:**
- Consumes: `toBrandName`, `readRecent`, `writeRecent`, `addRecent` (Task 2); `listProducts`; `Product` preview component.
- Produces:
  - `buildRelatedQuery(product): { category_id?: string[]; collection_id?: string[] }` pure helper in `related-products/related-query.ts`: prefers the brand category (child of `brands`), otherwise the first non-brand category, otherwise the collection; empty object when none. `RelatedProducts` uses it, excludes the current product, caps at 8, returns `null` when empty.
  - `RecentlyViewed`: on mount reads storage, records `productId` (`writeRecent(addRecent(...))`), fetches the other ids with `listProductsByIds`, renders nothing when there are none or storage fails; no throw.

- [ ] **Step 1: Write failing tests**: `buildRelatedQuery` (brand wins, department fallback, collection fallback, none), `RecentlyViewed` (records current id, hides current from list, hides when storage throws, hides when list empty; mock `listProductsByIds`).
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement. Step 4: Run vitest, tsc, lint. Commit** `feat(storefront): related and recently viewed products`.

---

### Task 7: Page wiring, SEO metadata, JSON-LD, layout

**Files:**
- Modify: `apps/storefront/src/app/[countryCode]/(main)/products/[handle]/page.tsx`, `apps/storefront/src/modules/products/templates/index.tsx`
- Create: `apps/storefront/src/modules/products/components/product-jsonld/index.tsx` (server component rendering `<script type="application/ld+json">` with `serializeJsonLd`); test `template.test.tsx` for the template's empty-data behaviour if practical with mocks

**Interfaces:**
- Consumes: Tasks 1-6 components and helpers; `getStoreName`; `listReviews`.
- Produces:
  - `generateMetadata`: title `${product.title} | ${getStoreName()}`, `description` from `buildDescription`, `alternates.canonical` (path `/${countryCode}/products/${handle}`), Open Graph and Twitter images from `product.images` (fallback thumbnail), `openGraph.type` `"website"`.
  - Page passes to the template: `brand`, `brandHref` (`/categories/${category.handle}` for the brand category when it has a handle), `shippingNote` and `returnsNote` read from `process.env.NEXT_PUBLIC_SHIPPING_NOTE` / `NEXT_PUBLIC_RETURNS_NOTE` on the server.
  - Template order: two columns from the `small` breakpoint (gallery left; sticky info and purchase panel right); below: description is inside info, then `FragranceProfileSection`, `ProductTabs`, `ProductReviews` (in Suspense with an error-safe fallback), `RelatedProducts`, `RecentlyViewed`. Remove `ProductOnboardingCta` from the product page. Add `ProductJsonLd` (price from the cheapest variant calculated price, `inStock` from variants via `getAvailability`, rating and up to 5 reviews from `listReviews`; when `listReviews` returns `null` omit rating).
  - The existing 404 behaviour and `v_id` variant image selection stay.

- [ ] **Step 1: Write failing tests** for what is testable without a server runtime: JSON-LD component output (omits offers/rating when absent, no raw `<`), and a template render with a bare product (no metadata, no images, no variants) not throwing (mock server-only children).
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement. Step 4: Run vitest, tsc, lint. Commit** `feat(storefront): product page wiring, metadata and structured data`.

---

### Task 8: Documentation

**Files:**
- Create: `docs/storefront/PRODUCT_PAGE.md`

**Interfaces:**
- Produces: a plain, factual doc covering page sections and when each hides; owner setup (metadata keys and accepted shapes with examples, brand categories under `brands`, `NEXT_PUBLIC_SHIPPING_NOTE` and `NEXT_PUBLIC_RETURNS_NOTE`, review moderation in Admin); the reviews route (request, response, caching, what is never exposed); Buy now flow; related and recently viewed rules; SEO (metadata and JSON-LD fields); failure behaviour; what is deliberately not done (spec Out of scope list). Read the code first and describe only what is built. End with `## Verification results` and the line `Filled in during phase verification.`

- [ ] **Step 1: Write the doc. Step 2:** `npx vitest run` from `apps/storefront`. **Step 3: Commit** `docs(storefront): product page guide`.

---

### Task 9: Verification (controller)

Run backend jest on the reviews route and helpers, storefront typecheck, lint (count `Error:`), full vitest, deploy tests, sibling-copy `next build` (outside the repo, junction `node_modules`, no BOM in `package.json`), secret scan, and, if a backend running this branch is available, `curl` the reviews route. Record results in `PRODUCT_PAGE.md` under `## Verification results`.
