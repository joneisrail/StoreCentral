# Storefront Phase 5: Product detail page design

Date: 2026-11-27. Brief: `apps/storefront/CLAUDE.md`, Phase 5. Builds on Phase 4 (catalog, merged at `bcf6f93322`). Decisions were approved with "take all recommended".

## Understanding

- **Goal:** a product page that sells a fragrance, working on the real Perfume Center records (3,431 single-variant products). Every fragrance field appears when its data exists and is hidden when it does not. Nothing is invented.
- **Today:** the page is the stock Medusa template: gallery, title, description, an Information and Shipping accordion (material, country, type, weight, dimensions), variant options, add to cart, related products. No brand, SKU, notes, quantity selector, Buy now, reviews, recently viewed. Metadata is the title only.
- **Reviews backend:** module `review` (`product_id`, `customer_id`, `order_id`, `rating` 1-5, `title`, `comment`, `status` pending/approved/rejected). Store routes: `POST /store/reviews` (authenticated customer, upsert workflow) and `DELETE /store/reviews/:id`. Admin routes exist under `/admin/reviews` for moderation. There is no public read route and no average.
- **Imported data:** brand (child of category `brands`), department category (men, women, sets...), SKU `AI...`, barcode, country of origin, price, one picture. No notes, family, concentration or size options.
- **Assumption:** each product has one variant. The size selector shows only when a product has more than one size variant.

## Decisions

1. **Metadata keys** (same as Phase 4 plus three): `gender`, `fragrance_family`, `concentration` (strings), `top_notes`, `middle_notes`, `base_notes` (array of strings or one comma-separated string). Parsing reuses the Phase 4 rules (trim, collapse whitespace, drop blanks, de-duplicate case-insensitively, cap 30). A storefront-side pure helper `toFragranceProfile(product)` returns only fields with values. Brand is the product's category whose parent handle is `brands`; gender falls back to nothing (it is not derived from the department).
2. **Page content, in order:**
   - Gallery with thumbnails (existing component, `sizes` hints added, alt text from the title).
   - Header: brand (link to its category page), title, SKU of the selected variant, price with the original price struck through when on sale, availability line ("In stock" / "Out of stock" / "Available to order" for backorder), review summary (stars and count, only when approved reviews exist).
   - Purchase panel: variant options (only for products with more than one variant), quantity selector (1 to 10, and not above stock when stock is tracked), Add to cart, Buy now.
   - Description.
   - Fragrance profile: family, gender, concentration, then top, middle and base notes. The whole block is omitted when empty.
   - Specifications: country of origin, barcode, weight, dimensions, material, type, only rows with values.
   - Shipping and returns: text comes from a new optional env `NEXT_PUBLIC_SHIPPING_NOTE` and `NEXT_PUBLIC_RETURNS_NOTE` read on the server and passed down; when unset the accordion item is omitted (no invented policy).
   - Reviews, related products, recently viewed.
3. **Buy now:** adds the chosen variant and quantity with the existing `addToCart` action, then navigates to `/{countryCode}/checkout`. On error the Phase 2 toast shows a fixed message "Couldn't add to cart" (server-action errors are masked in production).
4. **Variants and price:** the existing option selection stays. Price, SKU, availability and Add to cart follow the selected variant. A variant not available for the region disables the purchase panel with a message.
5. **Reviews, backend:** new public route `GET /store/products/:id/reviews` returning `{ reviews, count, average }` for `approved` reviews only, paginated (`limit` default 10, max 50, `offset`), newest first. Reviewer is shown as a first name or "Customer" (no email, no ids). `average` is rounded to one decimal, `null` when count is 0. The response may be cached for 60 seconds. Pure helpers (`toPublicReview`, `toAverage`) are unit-tested.
6. **Reviews, storefront:** a Reviews section lists approved reviews with a "Load more" button (no rating histogram). Submitting needs a signed-in customer (existing customer session): signed-in users get a form (rating 1-5 required, title and comment required, lengths 100 and 2,000 characters); guests see "Sign in to write a review" linking to the account login. After submit the section says the review awaits approval. Failure shows an inline message and keeps the typed text. Reviews are fetched on the server for the first page so they render for crawlers.
7. **Related products:** same brand first, then same department category, excluding the current product, at most 8, from the existing related-products component and product list function. Empty result hides the section.
8. **Recently viewed:** `localStorage` key `sc-recently-viewed`, array of product ids (cap 12, most recent first, current product excluded when rendering). Every access in try/catch; corrupt JSON is ignored and overwritten. Rendered as a client section that fetches those products by id (one query, region-priced) and hides when empty.
9. **SEO:** `generateMetadata` builds a description from brand, family and a trimmed description (max 160 characters), canonical URL, Open Graph and Twitter images from the product images. A server-rendered `Product` JSON-LD block carries name, image, description, sku, brand, offers (price, currency, availability) and `aggregateRating` and up to 5 reviews only when approved reviews exist. A product without a description still gets a valid description string.
10. **Images:** `sizes` hints on the gallery main image and thumbnails; optimisation itself stays off until Phase 7.
11. **Layout:** mobile single column (gallery, header, purchase panel, details); from the `small` breakpoint two columns (gallery left, sticky header and purchase panel right) with the details below. A sticky bottom Add to cart bar on mobile is not built (YAGNI).

## Architecture

### Backend (`apps/backend/src`)
- `api/store/products/[id]/reviews/route.ts`: GET handler using the review module's list with filter `{ product_id, status: "approved" }`; `helpers`: `toPublicReview`, `toAverage` with unit tests. Middleware for query validation (`limit`, `offset`) with Zod from `@medusajs/framework/zod`. Reads go through the module service (query only; no mutation so no workflow).
- No change to `POST /store/reviews`.

### Storefront (`apps/storefront/src`)
- `lib/util/fragrance-profile.ts` (+ test): `toFragranceProfile`, `toBrandName`.
- `lib/data/reviews.ts`: `listReviews(productId, offset)` (server, tagged cache) and `createReview` server action using the authenticated customer token.
- `lib/util/recently-viewed.ts` (+ test): pure parse, serialise, add.
- `modules/products/components/`: `fragrance-profile`, `product-specs`, `quantity-selector`, `buy-now-button`, `reviews/` (`review-summary`, `review-list`, `review-form`), `recently-viewed`; updates to `product-info`, `product-tabs`, `product-actions`, `related-products`, `image-gallery`.
- `app/[countryCode]/(main)/products/[handle]/page.tsx`: metadata, JSON-LD, template wiring.
- `docs/storefront/PRODUCT_PAGE.md`.

## Error handling and edge cases

- No metadata, no brand, no images, no description, no variants: the page renders without those blocks and never throws. A product with no variants shows "Unavailable".
- `notes` as `"rose, oud, rose"`, array with a number, or empty string: normalised per decision 1.
- Reviews route down or slow: the section shows "Reviews are unavailable right now" and the rest of the page renders (the fetch is isolated in Suspense with an error fallback).
- Review submit while signed out, expired session, duplicate (the workflow upserts per customer and product): clear inline message; text is kept.
- Quantity beyond stock or below 1: clamped; Add to cart disabled for out of stock.
- Recently viewed storage unavailable: section hidden, no throw.
- JSON-LD values are JSON-escaped (`<` replaced) so a title with `</script>` cannot break out.
- Unknown handle returns 404 (existing behaviour, kept).

## Testing

- Backend unit tests: `toPublicReview` (no email or ids, first-name fallback), `toAverage` (empty, rounding), route handler filters approved only and clamps `limit`.
- Storefront vitest: `toFragranceProfile` (strings, arrays, blanks, caps), recently-viewed helper (cap, dedupe, corrupt), QuantitySelector (clamp, stock cap), BuyNow (calls `addToCart` once then navigates; error toast fixed text), ReviewForm (validation, signed-out state, success message, failure keeps text), ReviewSummary hidden when count is 0, specs and profile hide empty rows, JSON-LD builder (escapes `<`, omits rating without reviews), metadata description length.
- Verification at phase end: backend jest and typecheck for touched files, storefront typecheck, lint (count `Error:` lines, zero), vitest, sibling-copy `next build`, secret scan, `curl` of the new reviews route on a running backend, and the built storefront returning 200 for a real product page. Browser checks only if a browser tool exists.

## Out of scope

Wishlist on the detail page (Phase 9 with accounts); verified-purchase badge and photo reviews; a rating histogram; review editing or deleting from the page; sticky mobile purchase bar; real image optimisation (Phase 7); fragrance discovery and "similar scents" (Phase 10); fill-in of notes, family and concentration data (owner or later import).

## Owner inputs needed (not blocking the build)

Fragrance metadata per product (`fragrance_family`, `gender`, `concentration`, `top_notes`, `middle_notes`, `base_notes`), optional shipping and returns text in `NEXT_PUBLIC_SHIPPING_NOTE` and `NEXT_PUBLIC_RETURNS_NOTE`, and review moderation in Admin.
