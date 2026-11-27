# Storefront Product Page

How the product detail page (`apps/storefront`, route `/{countryCode}/products/{handle}`) is built, where its data comes from, and what the owner has to enter for it to light up. This describes only what is implemented.

## Page sections and when each hides

In page order. Above the fold on wide screens the gallery is on the left and the info column (sticky from `small` up) is on the right.

| Section | What it shows | Hides when |
| --- | --- | --- |
| Image gallery | All product images stacked, or only the selected variant's images when that variant has its own | Never hides; with no images it renders empty |
| Brand | Brand name above the title, linked to the brand category | No brand category (see Brands). Plain text, not a link, when the brand category has no handle |
| Title | Product title as the `h1` | Never |
| Rating summary | Stars, average and count under the title | No approved reviews, or the reviews route failed |
| Purchase panel | Option pickers (only with more than one variant), price, availability and SKU of the selected variant, quantity, Add to cart, Buy now | Never. Add to cart and Buy now stay disabled until a valid variant is selected |
| Description | The product description, line breaks kept | Product has no description |
| Fragrance profile | Family, gender, concentration and Top, Middle and Base notes as chips | None of the metadata below is set. Each row and each note group hides on its own when empty |
| Specifications and Shipping and returns | Accordion with one or both items | Each item hides on its own; the whole block hides when both are empty |
| Customer reviews | Summary, review list with "Load more", the review form or a sign-in link | Never hides (shows "No reviews yet." or "Reviews are unavailable right now") |
| Related products | Up to 8 product cards | No related products, or the lookup fails |
| Recently viewed | Product cards | Nothing else viewed yet in this browser |

The purchase panel sits before the description in the info column. While the live panel loads, a disabled copy shows.

### Specifications

Rows, in order: Country of origin, Barcode (the first variant barcode), Weight (shown in grams), Dimensions (length x width x height, only when all three are set), Material, Type. A row with no value is dropped.

### Shipping and returns

Text comes from two environment variables, read on the server:

| Variable | Used for |
| --- | --- |
| `SHIPPING_NOTE` | Shipping paragraph |
| `RETURNS_NOTE` | Returns paragraph |

Either, both or neither may be set. Blank values count as unset. Line breaks are kept. When neither is set the "Shipping and returns" item is not shown. They are server-only variables (no `NEXT_PUBLIC_` prefix), read at runtime by the product page on the server and passed down as props, so changing them needs a restart of the storefront, not a rebuild. Do not rename them to `NEXT_PUBLIC_*`: those are inlined at build time.

## Owner setup

### Product metadata

Set these keys in each product's `metadata` in Medusa Admin. All are optional.

| Key | Accepted shapes | Example |
| --- | --- | --- |
| `gender` | string, comma-separated string, or array of strings | `"Women"`, `["Men","Women"]` |
| `fragrance_family` | same as `gender` | `"Woody"` |
| `concentration` | same as `gender` | `"Eau de Parfum"` |
| `top_notes` | string, comma-separated string, or array of strings | `"bergamot, pink pepper"`, `["bergamot","pink pepper"]` |
| `middle_notes` | same | `"rose, jasmine"` |
| `base_notes` | same | `"oud, amber"` |

`gender`, `fragrance_family` and `concentration` are read the same way as the notes below, as the catalog does. Several values are shown joined with ", " (for example `["Men","Women"]` shows as "Men, Women").

Notes are trimmed, inner whitespace is collapsed, blanks are dropped, duplicates are removed ignoring case (first spelling kept), non-string array items are ignored, and at most 30 are kept per key.

Example `metadata` JSON:

```json
{
  "gender": "Unisex",
  "fragrance_family": "Woody",
  "concentration": "Eau de Parfum",
  "top_notes": "bergamot, pink pepper",
  "middle_notes": ["rose", "jasmine"],
  "base_notes": "oud, amber, musk"
}
```

Note that the catalog guide's `notes` key feeds the `/store` Notes filter. The product page reads the three keys above instead, so a product needs both if it should appear under the filter and show its pyramid.

### Brands

Create a top-level product category with handle `brands`, then one child category per brand under it (the same convention as the catalog and homepage). The product's brand is the name of the first of its categories whose parent has handle `brands` and which has a non-blank name. The brand links to `/categories/<handle>` of that category.

### Review moderation

Customers' new reviews wait for approval. Approve or reject them in Medusa Admin at `/admin/reviews`. Only approved reviews appear on the page, in the rating summary and in the structured data.

## Purchase panel

- Variant options show only when the product has more than one variant. A product with a single variant preselects it.
- The selected variant id is kept in the `v_id` query parameter, and the page reads it to choose which images to show.
- Availability label: "In stock", "Available to order" (backorder) or "Out of stock". SKU shows when the variant has one.
- Stock rules: a variant that does not manage inventory is in stock with no limit; one that allows backorder is "Available to order" with no limit; otherwise it is in stock when its inventory quantity is above zero, and the quantity is the limit.
- Quantity starts at 1 and is limited to 10 per order or the stock quantity, whichever is lower. The field can be typed into; out-of-range values are clamped. It is clamped again when a different variant is selected.
- Add to cart adds the selected variant and quantity. A failure shows the fixed error toast "Couldn't add to cart" (server actions mask the real message in production).
- Add to cart reads "Select variant" until a variant is selected, and "Out of stock" when it cannot be bought.
- A second set of purchase controls appears fixed to the bottom on small screens once the main controls scroll out of view.

### Buy now

Buy now adds the selected variant and quantity to the cart, then goes to `/{countryCode}/checkout`. A second click while it runs is ignored, and Add to cart is disabled while it is pending. On failure the user stays on the page and sees the same fixed toast "Couldn't add to cart". It is disabled in the same cases as Add to cart (no variant, out of stock, adding in progress).

## Reviews

### Route

`GET /store/products/{id}/reviews` on the backend (`apps/backend/src/api/store/products/[id]/reviews`).

| Query | Meaning |
| --- | --- |
| `limit` | Page size. Default 10, maximum 50, minimum 1 |
| `offset` | Rows to skip. Default 0, minimum 0 |

Clamping is lenient: a value out of range is pulled into range, and a missing, empty or non-numeric value falls back to the default (decimals are truncated). The route never answers 400 for these.

Response:

```json
{
  "reviews": [
    {
      "id": "rev_...",
      "rating": 5,
      "title": "Lovely",
      "comment": "Long lasting.",
      "created_at": "2026-11-20T10:00:00.000Z",
      "author": "Amira"
    }
  ],
  "count": 12,
  "average": 4.6,
  "limit": 10,
  "offset": 0
}
```

- Approved reviews only, newest first.
- `count` and `average` cover all approved reviews for the product, not just the page. `average` is rounded to one decimal and is `null` when there are none.
- `author` is the customer's first name, or `"Customer"` when there is none. The customer's email and ids are never returned.
- `Cache-Control: public, max-age=60`, so a newly approved review can take up to a minute to show.

The storefront fetches the first 10 on the server for the rating summary and structured data, and again inside the reviews section. "Load more" asks for the next page, using the number of reviews already shown as the offset, and appears while fewer than `count` are shown. A "Load more" failure shows "Couldn't load more reviews. Please try again." and the button stays usable.

### Submitting a review

- A signed-in customer sees a form: rating 1 to 5, title (up to 100 characters), comment (up to 2000). All three are required and are checked in the browser before sending.
- A guest sees a "Sign in to write a review" link to the account page instead of a form.
- On success the form clears and shows "Thanks, your review is awaiting approval". The review does not appear until approved.
- Only customers who have bought the product can review it (verified purchase: a non-canceled, non-draft order containing the product). Anyone else is refused by the backend.
- Submitting again replaces the customer's earlier review of that product and resets it to pending. An approved review therefore disappears from the page until it is approved again (see `apps/backend/src/workflows/upsert-review.ts`).
- Server-action errors are masked in production, so the action never throws. It returns fixed texts: "Sign in to write a review" when there is no signed-in session, "Sign in again to write a review" when the backend answers 401, "Only customers who bought this product can review it" when the purchase check fails, and "Couldn't submit your review. Please try again." for any other failure. Double submits are ignored while one is in flight.

## Related products

- Looks for products in the same brand category; if the product has no brand, in its first category other than `brands`; if it has none, in its collection; if none of those, the section is not shown.
- Up to 8 cards, the current product excluded, gift cards excluded, limited to the region.
- Heading: "More from {brand}" when the product has a brand, otherwise "You may also like".
- A failed lookup hides the section; it never breaks the page.

## Recently viewed

- Stored in the browser's `localStorage` under `sc-recently-viewed` as a JSON array of product ids, newest first, at most 12, no duplicates.
- Visiting a product page records it. The section lists the other products in that list (not the current one), in order, fetched for the current region. Products no longer available are skipped.
- Nothing is shown the first time, in the server render, or when no other product is stored. If storage is blocked or holds corrupt data it reads as empty and the page works without the section.
- This browser only; there is no account sync.

## SEO

### Page metadata

| Field | Value |
| --- | --- |
| Title | `{product title} \| {store name}` |
| Description | The product description with whitespace collapsed, clipped to 160 characters with an ellipsis. With no description, `{brand} {title}.` plus ` A {family} fragrance.` when a family is set |
| Canonical | `/{countryCode}/products/{handle}` (no `v_id`) |
| Open Graph | type `website`, title, description, all product image URLs |
| Twitter | `summary_large_image` when there are images, otherwise `summary`; title, description, images |

Image URLs are all product images, falling back to the thumbnail, otherwise none.

### JSON-LD

A server-rendered `application/ld+json` script with a schema.org `Product`. Fields appear only when there is data for them.

| Field | Source |
| --- | --- |
| `name`, `url`, `image`, `description` | Title, canonical page URL, image URLs, the same description as the metadata |
| `sku` | SKU of the offer variant, when it has one |
| `brand` | `Brand` with the brand name, when there is one |
| `offers` | One `Offer`: price and currency of the offer variant, page URL, availability. Omitted when no variant has a calculated price |
| `aggregateRating` | Average and count of approved reviews. Omitted when there are none |
| `review` | Up to 5 of the newest approved reviews: author, date, title, body and rating. Omitted when there are none |

Details to know:

- The offer variant is the cheapest variant that is not out of stock, falling back to the overall cheapest variant if all are out of stock. Price, currency, SKU and availability all come from that one variant. They do not follow the variant the visitor selected.
- Availability is `InStock`, `OutOfStock` or `BackOrder` (`https://schema.org/BackOrder`), taken from the offer variant.
- Currency is the variant price's currency, falling back to the region's.
- The script text escapes `<` so a review cannot break out of it.

## Failure behaviour

- Unknown handle, or an unknown country code: not-found page.
- Reviews route fails, is unreachable or does not answer within 2.5 seconds: the rating summary and review stars are left out, the reviews section shows "Reviews are unavailable right now" with no form, and the structured data omits rating and reviews. The rest of the page renders.
- The reviews section throws while rendering: an error boundary replaces it with the same "Reviews are unavailable right now" message.
- Related products fails: section hidden.
- Recently viewed fails: section hidden.
- Add to cart or Buy now fails: toast "Couldn't add to cart".
- Product with no metadata, brand, description, images or notes: those parts hide; the page still renders.

## Deliberately not done

- Wishlist on the detail page (the heart exists on `/store` cards only).
- Verified-purchase badge on reviews.
- Photo reviews.
- Rating histogram.
- A new sticky mobile purchase bar. The template's existing bottom bar (shown on small screens when the main controls scroll out of view) is unchanged and was not reviewed here.
- Image optimisation (Phase 7): images are plain URLs and unoptimised.
- Fragrance discovery (Phase 10).
- Filling in notes, family and concentration data: the owner enters it.

## Not verified live

- The reviews route against a running backend. Its behaviour is described from the code and unit tests.
- The page in a browser. Layout, the bottom purchase controls and the toasts were not seen on a real screen.
- JSON-LD describes one offer, from the cheapest variant that is not out of stock. A product with several sizes advertises only that variant's price, SKU and availability, not a price range. Check that this suits the catalogue.

## Verification results

Verified 2026-11-27.

- Storefront: vitest 64 files / 370 tests pass; `tsc --noEmit` clean; `next lint` 0 `Error:` lines (existing hook warnings only).
- Backend: jest `src/api/store/products` 2 suites / 20 tests pass; `tsc` no errors outside integration-tests.
- Production build: `next build` of a sibling copy of apps/storefront at the branch head exited 0; `/[countryCode]/products/[handle]` is server-rendered on demand (dynamic), so `SHIPPING_NOTE` and `RETURNS_NOTE` are read at runtime.
- Secret scan of the branch diff: nothing found.
- NOT verified: `GET /store/products/:id/reviews` against a running backend (whether `pagination.order` on `query.graph` works on real Medusa is unproven; the backend running locally is on older code); the product page in a browser (layout, sticky panel, mobile bar); the reviews error boundary with the route down; `POST /store/reviews` end to end.
- Next step after deploy: restart the backend, then `curl` the reviews route for a real product id and open a product page.
