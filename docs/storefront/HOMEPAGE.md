# Storefront Homepage

How the storefront homepage (`apps/storefront`, route `src/app/[countryCode]/(main)/page.tsx`) is built, where its data comes from, and how the owner changes it. This describes only what is implemented.

## Section map

Page order, top to bottom. The announcement bar sits above the nav in `layout.tsx`; the rest is in `page.tsx` and `modules/home/templates/home-sections.tsx`.

| # | Section | Data source | Hides when |
| --- | --- | --- | --- |
| 1 | Announcement bar | `homepageContent.announcement` in `src/lib/content/homepage.ts` | `announcement` is `null`, or the visitor dismissed it (stored in `sessionStorage` per message text, so it returns in a new session or when the text changes) |
| 2 | Hero | `homepageContent.hero` | Never hidden. Without an `image` it shows a gradient background with dark text |
| 3 | Shop by category | Medusa top-level product categories (no parent), excluding the one with handle `brands` | No such categories |
| 4 | Shop by brand | Children of the category with handle `brands` | No `brands` category, or it has no children |
| 5 | Product sections | `PRODUCT_SECTIONS` in `src/lib/content/homepage-sections.ts`, in array order (below) | Collection missing in Medusa, or the section has no products |
| 6 | Promo banners | `homepageContent.promos` | Array is empty |
| 7 | Editorial blocks | `homepageContent.editorial` | Array is empty |
| 8 | Newsletter | `NEXT_PUBLIC_NEWSLETTER_ACTION_URL` | Variable unset, empty, not a valid URL, or not `https:` |

The nav also has a search button (below `small`) and a search field button (from `small` up) in `modules/layout/components/search/index.tsx`. Both open the existing search drawer.

Product sections, in the order defined:

| Order | Title | Source |
| --- | --- | --- |
| 1 | Best sellers | collection handle `best-sellers` |
| 2 | New arrivals | latest products (`order: -created_at`), no collection needed |
| 3 | Trending fragrances | collection handle `trending` |
| 4 | Men's collection | collection handle `mens` |
| 5 | Women's collection | collection handle `womens` |
| 6 | Unisex collection | collection handle `unisex` |
| 7 | Arabic fragrances | collection handle `arabic` |
| 8 | Niche fragrances | collection handle `niche` |

Each section loads up to 8 products with `*variants.calculated_price` for the visitor's region. The "View all" link goes to `/collections/<handle>` for collection sections and to `/store` for New arrivals. The grid is 2 columns on small screens and 4 from `lg`.

## Owner setup in Medusa Admin

The handles must match exactly (lowercase, as listed).

1. Collections: create seven collections with handles `best-sellers`, `trending`, `mens`, `womens`, `unisex`, `arabic`, `niche`. Add products to each. `new-arrivals` needs no collection.
2. Brands: create a top-level product category with handle `brands`. Create one child category per brand under it. Each child becomes a brand tile. The strip shows at most the first 12 brands (`MAX_BRAND_TILES` in `src/lib/data/homepage.ts`).
3. Shop categories: any other top-level category (no parent) becomes a "Shop by category" tile. The `brands` category is excluded from that grid.
4. Tile images (optional): on a category, set `metadata.image_url` to an `https://` URL. Values that are not strings or do not start with `https://` are ignored and the tile shows its name only. Tiles render this with a plain `<img>` (lazy loaded, empty alt text because the name is shown beside it).

Tile link shape: both category tiles and brand tiles link to `/categories/<handle>` (through the localized link, so the country code is prefixed). Brand tiles do not link to a `/brands` page.

## Content file

`src/lib/content/homepage.ts` exports `homepageContent`. Edit it and redeploy; there is no admin UI for it.

- `description`: page meta description.
- `announcement`: `null` for none, or `{ text, href? }`. With `href` the whole text is a link (localized path such as `/store`).
- `hero`: `{ headline, eyebrow?, subheadline?, cta?: { label, href }, image?: { src, alt } }`. `headline` is required. The image is rendered with `next/image` (fill, priority) under a flat 0.65 charcoal overlay with light text. If the image fails to load, the hero falls back to the gradient with dark text. The image host must be allowed by `images.remotePatterns` in `next.config.js` (or be a local file under `public/`).
- `promos`: array of `{ id, title, href, ctaLabel, text?, image?: { src, alt } }`. Shown as a two-column grid from `small`. `id` must be unique.
- `editorial`: array of `{ id, title, text, href?, linkLabel?, image?: { src, alt } }`. The link label defaults to "Read more". `id` must be unique.

Promo and editorial images use a plain lazy-loaded `<img>`.

Example (promo and announcement):

```ts
announcement: { text: "Free shipping over $75", href: "/store" },
promos: [
  { id: "oud", title: "Oud edit", href: "/collections/arabic", ctaLabel: "Shop oud" },
],
```

## Newsletter

The section reads `NEXT_PUBLIC_NEWSLETTER_ACTION_URL` through `getNewsletterAction()`.

- Value must be an `https:` URL. Anything else (unset, blank, `http:`, unparsable) hides the section.
- The form is a plain HTML POST to that URL, with one field named `email` (`type="email"`, required). No JavaScript, no API call from the storefront, no success message of its own; the visitor lands on whatever the provider returns.
- The value is read on the server at runtime (not inlined into client code). The Docker and compose setup passes it at both build time and run time, so set it in both places to keep them consistent.

## Adding a product section

Add one entry to `PRODUCT_SECTIONS` in `src/lib/content/homepage-sections.ts`. Position in the array is position on the page.

```ts
{ id: "oud", title: "Oud", kind: "collection", collectionHandle: "oud" },
```

Then create a collection with that handle in Medusa Admin. `kind: "latest"` is only used for `new-arrivals`. No other code change is needed.

## Failure behaviour

- Region lookup fails, or the collections request fails: only the product sections render nothing, because `getHomepageSections` returns `null` and `ProductSections` returns `null`. The hero, shop by category, shop by brand, promos, editorial and newsletter do not depend on region or collections and still render. A one-line `console.error` is logged.
- Collection handle not found: that section is skipped.
- A product list request fails: that section returns an empty list and renders nothing.
- Category request fails: the category grid or brand strip renders nothing.
- The data functions in `src/lib/data/homepage.ts` catch their errors and do not throw, so a Medusa outage does not produce an error page for the homepage.
- The categories, brands and product sections each sit in their own `Suspense` boundary. The fallbacks are a tile skeleton for categories, a six-tile brand skeleton for brands, and a single product-section skeleton for the whole product block (the real block has one section per entry in `PRODUCT_SECTIONS`, so it can grow past that fallback). Promos, editorial and newsletter are not suspended. Category and brand fetches do not wait on region or collections.
- The reveal-on-scroll animation (`reveal`) fails open: no `IntersectionObserver` or reduced motion means content shows immediately, and anything still hidden after 3 seconds is shown.

## Deliberately not done

- Search system changes: the nav search field only opens the existing drawer.
- `/brands` pages: brand tiles link to the category page.
- Ranking best sellers from orders: "Best sellers" is whatever the owner puts in the `best-sellers` collection.
- Image optimisation or a CDN: `images.unoptimized` is true; tile, promo and editorial images are plain `<img>` elements.
- A newsletter provider integration: only the form POST to a URL the owner supplies.

## Verification results

Date: 2026-11-25. Run on branch storefront-phase-3 before the final review.

- Typecheck (tsc --noEmit): 0 errors.
- Unit tests (vitest, apps/storefront): 28 files, 175 tests, all pass.
- Lint (next lint): 0 errors, 3 warnings that were there before this phase.
- Deploy workflow tests (node --test deploy/*.test.mjs): 66 pass, 0 fail.
- Production build (next build) from a copy outside the worktree, with NEXT_PUBLIC_STORE_NAME set to a custom value: exit 0.
- Secret scan of .next/static for sk_live, sk_test and whsec_: no matches.
- Built server against the local backend (4 demo clothing products, no collections, no brands category): /us, /us/store and /us/cart return 200 and /us/design-system returns 404. The home page contains the hero, the shop-by-category tiles (links like /categories/pants) and a New arrivals section with the four demo products; it contains no Best sellers, Trending, Shop by brand, promo, editorial or newsletter section, as expected with no matching data. No "Medusa Store" text; the custom store name appears.

Not checked: pages were not opened in a browser (no screenshots, no check of layout shift, fonts as rendered, the reveal animation or the search field on real screens); a homepage with real collections, brands and promos (only the empty and demo-data cases were run against the backend; the filled cases are covered by unit tests with fixtures); the hero image path with a real image; the newsletter form against a real provider; the Docker image build; the first CI run.
