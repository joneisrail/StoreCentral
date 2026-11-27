# Storefront Catalog

How the storefront product catalog (`apps/storefront`) is built, where its data comes from, and what the owner has to enter for it to light up. This describes only what is implemented.

## What the catalog shows and where

| Page | Route | What it has |
| --- | --- | --- |
| All products | `/store` | Search-driven listing (InstantSearch through the backend `/store/search`): full filter set, sort, text search, active-filter chips, result count, grid/list toggle, numbered pagination, quick add, wishlist hearts, badges |
| Category | `/categories/<handle>` | Server-rendered listing: sort, grid/list toggle, numbered pagination |
| Collection | `/collections/<handle>` | Same as category |

The full filter set exists only on `/store`. Category and collection pages keep their own server-rendered listing. They use the same card layout, but their cards have no badges, wishlist heart or quick add (those are on the `/store` cards only).

Page size is 12 in both grid and list view. Grid is 2 columns on small screens, 3 from `small`, 4 from `medium`. List view is one column with the image on the left (2/5 width) and the text on the right.

On `/store`, below the `small` breakpoint a sticky "Filters (N)" button, N being the number of active filters, opens a left drawer with sort, all filter groups, "Clear all" and "Show N results". From `small` up the filters are a left column. Active filters show as removable chips above the grid at every width, with a "Clear all" button.

## Owner setup

### Product metadata

Set these keys in each product's `metadata` in Medusa Admin. All are optional. A product without them indexes with empty values and simply does not appear under that filter.

| Key | Accepted shapes | Example |
| --- | --- | --- |
| `gender` | string, comma-separated string, or array of strings | `"Women"`, `"Men, Unisex"`, `["Men","Unisex"]` |
| `fragrance_family` | same | `"Woody"`, `["Floral","Fruity"]` |
| `notes` | same | `"rose, oud, amber"`, `["rose","oud","amber"]` |
| `concentration` | same | `"Eau de Parfum"` |

Values are trimmed, inner whitespace is collapsed, blanks are dropped, duplicates are removed ignoring case (the first spelling is kept), non-string items in an array are ignored, and at most 30 values are kept per key. `"rose, oud, rose"` becomes `rose`, `oud`.

`concentration` is indexed, but no filter group on the storefront uses it yet.

### Brands

Create a top-level product category with handle `brands`, then one child category per brand under it (the same convention as the homepage). A product's brand is the name of any of its categories whose parent has handle `brands`. A product in several brand categories lists all of them.

The Category filter excludes brand categories and the `brands` category itself, so brands appear only under Brand. This needs a reindex on an index built before that change (below).

### How stock is determined

A product is `in_stock` when at least one of its variants can be bought: the variant has `manage_inventory` off, or `allow_backorder` on, or an available quantity above zero. Available quantity is stocked minus reserved, summed over every stock location. A product with no variants is not in stock. Products with exactly one variant also store that variant's id, which quick add uses.

A stock change re-indexes the product through the inventory-level and reservation-item events. Changes made through the Inventory Module directly (not through a workflow) and some link changes emit no event and are not picked up until the product is re-indexed some other way. These gaps are listed as `TODO` comments in `apps/backend/src/search/product.ts`.

### Reindex on deploy, and what to check

The new index fields are a schema change, so the search module reindexes on the next backend boot. Existing indexes must be reindexed for the Category-facet change too.

New index fields are not verified against a live backend running this branch. After deploy, check `/store/search`:

- A search request returns hits that carry `brand`, `gender`, `fragrance_family`, `notes`, `concentration`, `in_stock` and `single_variant_id`.
- Facet counts exist for `brand`, `gender`, `fragrance_family`, `notes`, `in_stock` and `category`.
- The `category` facet no longer lists brand names or `brands`.
- `in_stock` is true for a product you know is available and false for one that is out of stock.

## URL parameters

### `/store`

InstantSearch history routing writes the state as top-level query parameters (the index name is not used as a prefix). Updates are debounced by about 400 ms.

| Parameter | Meaning | Example |
| --- | --- | --- |
| `query` | Free-text search | `query=oud` |
| `sortBy` | Sort, as the index sort string. Omitted for relevance | `sortBy=product/sort/created_at:desc` |
| `page` | Page number, starting at 1 | `page=2` |
| `view` | `list` for list view. Anything else, or absent, is grid | `view=list` |
| `refinementList[brand][0]` | Selected brands (also `category`, `gender`, `fragrance_family`, `notes`, `labels`, `option_values`) | `refinementList[brand][0]=Dior` |
| `range[min_price_<cur>]` | Price range as `min:max` in the indexed currency | `range[min_price_usd]=50:150` |
| `toggle[in_stock]` | In stock only | `toggle[in_stock]=true` |
| `toggle[on_sale_<cur>]` | On sale only | `toggle[on_sale_usd]=true` |

Sort values:

| Label | `sortBy` value |
| --- | --- |
| Relevance | `product` |
| Latest Arrivals | `product/sort/created_at:desc` |
| Price: Low -> High | `product/sort/min_price_<cur>:asc` |
| Price: High -> Low | `product/sort/min_price_<cur>:desc` |
| Title: A -> Z | `product/sort/title:asc` |
| Title: Z -> A | `product/sort/title:desc` |

`<cur>` is the region's currency in lowercase if the index holds it (`eur` or `usd`), otherwise `eur`.

The parameter names above come from InstantSearch's standard routing for the widgets used. They were derived from the code, not captured from a browser session. Brackets appear percent-encoded in a real address bar.

Example shareable URL (brackets shown unencoded):

```
/us/store?query=oud&refinementList[brand][0]=Dior&toggle[in_stock]=true&sortBy=product/sort/created_at:desc&page=2&view=list
```

The `view` value is applied to the URL on every write, so it survives filter changes and back and forward. Page 1 omits `page`. A page beyond the last page shows the empty state.

### Category and collection pages

| Parameter | Meaning | Example |
| --- | --- | --- |
| `sortBy` | `created_at` (default), `price_asc` or `price_desc` | `sortBy=price_asc` |
| `page` | Page number, starting at 1 | `page=2` |
| `view` | `list` for list view, otherwise grid | `view=list` |
| `optionValueIds` | Option-value ids to filter by (read from the URL; no picker is shown on category pages) | `optionValueIds=optval_123` |

Example: `/us/collections/arabic?sortBy=price_asc&page=2&view=list`. The grid/list toggle on these pages (`?view=list`) is a pair of plain links that keep the other parameters and drop `view` for grid.

## Filter groups and when each hides

Groups on `/store`, in this order. A group renders only when the current results have values for it.

| Group | Source field | Hides when |
| --- | --- | --- |
| Brand | `brand` | No products in the results have a brand |
| Category | `category` | No categories in the results (brand categories are excluded) |
| Gender | `gender` | No values |
| Fragrance family | `fragrance_family` | No values |
| Notes | `notes` | No values |
| Price | `min_price_<cur>` | No price stats, or every product costs the same |
| In stock only | `in_stock` | The results cannot be split by availability |
| On sale only | `on_sale_<cur>` | Nothing is discounted |
| Option groups (for example Size) | `option_values` | No option values |
| Labels | `labels` | No tags |

List groups show the top 20 values by count, then "Show more" (up to 200). A group with more than 20 values also gets a search box over its values.

- Refined values may disappear from a facet list while a facet search is active (standard InstantSearch behaviour). The chips above the grid still remove them.
- Facet search returns at most 10 hits.

With the current demo data (4 clothing products, no metadata) the visible groups are Category, Price, In stock only and On sale only (the last only if a price list applies).

## Badges

At most two badges per card, shown over the image corner in this order:

1. Sold out: `in_stock` is false. A hit without the field is never marked sold out.
2. Sale: the region currency's `on_sale_<cur>` is true.
3. New: `created_at` is within the last 30 days.

## Quick add

A button under each `/store` card, outside the card link:

- `in_stock` false: disabled "Sold out".
- One variant (the hit has `single_variant_id`): "Add to cart" adds quantity 1 and shows an "Added to cart" toast, then refreshes the page data. A second click while the first is running is ignored. A failure shows a fixed "Couldn't add to cart" error toast (server actions hide the real message in production) and the button works again.
- Several variants: "Choose options" links to the product page.

## Wishlist

A heart button on each `/store` card. Toggling sets `aria-pressed` and shows an "Added to wishlist" or "Removed from wishlist" toast.

- Stored in the browser's `localStorage` under `sc-wishlist` as a JSON array of product ids.
- This browser only. There is no account sync and no wishlist page; both are Phase 9.
- Cap of 200 ids. Adding past the cap drops the oldest.
- If storage is blocked, the heart still works for the current session from memory and the list is lost on reload. A corrupt stored value is read as empty and overwritten on the next toggle.
- Changes in another tab are picked up through the `storage` event.

## Failure behaviour

- Search request fails: the grid area shows "Couldn't load products" with the error message. The page and filters stay.
- No results: "No products matched these filters." with a "Clear all" button that drops filters, query and page but keeps the sort. This also covers a page number past the end.
- First load and page-only changes show a skeleton grid of 12 cards; filter changes keep the current results visible while the new ones load.
- Stored `in_stock` or other fields missing on a hit (an index not yet rebuilt): no Sold out badge, quick add falls back to "Choose options", and the new filter groups stay hidden.
- A product with no metadata, no brand category or no variants indexes without error and does not stop other products from indexing.

## Deliberately not done

- Server-rendered or crawlable `/store` results: the listing is client-side search, so crawlers do not see products there.
- Brand pages: brands are a filter only.
- A search page, autocomplete and synonyms.
- Wishlist page and account sync (Phase 9).
- Filters on category and collection pages: they keep sort only (an `optionValueIds` URL parameter is still read, but the category page hides the option picker).
- Image optimisation or a CDN: images are plain URLs, unoptimised.
- Computing "best seller".

## Verification results

Filled in during phase verification.

## Image sizes

Product cards pass a `sizes` hint to `Thumbnail` (grid: 25vw on desktop, 33vw on tablet, 50vw on phones; list: 40vw). Image optimisation itself stays off until Phase 7 (`images.unoptimized`), so the hint has no effect until then.
