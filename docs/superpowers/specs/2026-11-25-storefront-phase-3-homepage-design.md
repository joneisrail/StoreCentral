# Storefront Phase 3: Homepage design

Date: 2026-11-25. Brief: `apps/storefront/CLAUDE.md`, Phase 3 (18 homepage sections). Builds on Phase 2 (design system, merged at `d12121f744`). Decisions below were approved with "take all recommended".

## Understanding

- **Goal:** a premium homepage that renders only real Medusa data. Acceptance from the brief: works with real data, no production mock products, mobile layout optimised, hero content loads quickly.
- **Today:** the page is the starter hero ("Ecommerce Starter Template") plus one rail per collection. The local store has 4 demo clothing products, 4 categories and no collections. There is no data for brands, gender, fragrance family, best sellers or trending, and the owner has not yet given the real catalog source, image host or store name.
- **Assumption:** the real catalog will be loaded into Medusa later (Phase 4a channel import or CSV); the homepage must light up as soon as the data exists, with no code change.

## Decisions

1. **Product sections come from Medusa collections by fixed handle.** Section to handle: best sellers `best-sellers`, trending `trending`, men's `mens`, women's `womens`, unisex `unisex`, Arabic `arabic`, niche `niche`. New arrivals needs no collection: it is the 8 latest products by `created_at`. Best sellers and trending are owner-curated collections for now; ranking from order data is out of scope.
2. **A section renders only when its data exists.** Missing collection, empty collection, or a failed fetch hides that section. The page never shows mock products, empty shelves or an error because one section failed.
3. **Brands are the child categories of a top-level category with handle `brands`.** The section is hidden when that parent has no children. Brand links go to `/categories/brands/<handle>` (existing category route; as built, the real tile link is `/categories/<handle>` because the category route resolves a single handle; a dedicated `/brands` page is Phase 4 or 11).
4. **Shop by category** lists the other top-level categories (all except `brands`) as image-less typographic tiles unless a category has `metadata.image_url`, in which case it uses that image.
5. **Hero, announcement bar, promotional banners and editorial blocks come from one typed content file** `apps/storefront/src/lib/content/homepage.ts`. Default state: announcement bar hidden (no text), hero shows neutral copy and a palette gradient with no image, promos and editorial are empty arrays (sections hidden). No CMS.
6. **Newsletter is shown only when `NEXT_PUBLIC_NEWSLETTER_ACTION_URL` is set to an https URL.** The form is a plain HTML POST to that URL (email field named `email`), so no backend is needed and nothing is simulated. Unset or non-https hides the section. Variable is optional and non-secret; added to `.env.template`, `storefront.Dockerfile`, compose, `deploy/.env.example`, README and `docs/ops/secrets.md` rows.
7. **Search bar:** on screens at or above the `small` breakpoint the nav gets a field-styled button ("Search") that opens the existing search drawer; below it the existing icon stays. No new search system (Phase 6).
8. **Hero image:** one `next/image` with `priority`, fixed aspect box (16/9 at desktop, 4/5 on phones via `sizes` and an aspect class) so there is no layout shift; image source and alt come from the content file; when no image is set or it fails, the palette gradient shows and text stays readable (charcoal on ivory).
9. **Motion:** subtle fade and rise via `motion-safe:` classes only. Below-the-fold sections use a small client `Reveal` wrapper (IntersectionObserver) that fails open: content is visible without JavaScript, without IntersectionObserver, and under reduced motion.
10. **Streaming:** hero and announcement are static and render first. Each data section is an async server component inside its own `Suspense` with a skeleton of the same height (Phase 2 `Skeleton*`), so slow collections never block the hero.

## Section map (brief order)

1 announcement bar (new, above nav) | 2 main navigation (exists) | 3 search field (nav, decision 7) | 4 hero | 5 shop by category | 6 featured brands | 7 best sellers | 8 new arrivals | 9 trending | 10 men's | 11 women's | 12 unisex | 13 Arabic | 14 niche | 15 promotional campaigns | 16 editorial | 17 newsletter | 18 footer (exists). Page order follows the brief.

## Architecture

- `src/lib/content/homepage.ts`: types `HomepageContent`, `Promo`, `EditorialBlock`; exported `homepageContent` (defaults per decision 5). `getNewsletterAction(env?): string | null` returns the URL only if it parses as https.
- `src/lib/content/homepage-sections.ts`: `PRODUCT_SECTIONS: { id; title; collectionHandle }[]` and pure `resolveProductSections(config, collections): ResolvedSection[]` (drops sections whose collection is missing).
- `src/lib/data/homepage.ts` (server only): `listNewArrivals(regionId, countryCode)`, `listBrandCategories()`, `listShopCategories()`; each catches errors, logs a one-line server message without payload, returns an empty list.
- `src/modules/home/components/`: `announcement-bar` (client, dismissible, remembers dismissal in `sessionStorage` with try/catch), `hero`, `category-grid`, `brand-strip`, `product-section` (server; renders `ProductCardView` grid, 2 columns on phones, 4 on large; "View all" link to the collection), `promo-banners`, `editorial`, `newsletter`, `reveal` (client), plus a `home-skeleton` set.
- `src/app/[countryCode]/(main)/page.tsx`: composes the sections; metadata title from `getStoreName()` and description from the content file.
- Nav: `search-field` button added next to the existing `Search`; shares the drawer open state with it.
- Docs: `docs/storefront/HOMEPAGE.md` (handles, owner setup steps, how to add a section, what hides when).

## Error handling and edge cases

- Region or collections API failure: the page still renders hero and static sections; data sections hide; no thrown error to the error boundary from a section.
- Collection with products lacking a price: card renders without a price line (existing `ProductCardView` behaviour).
- Very long collection or category titles wrap inside their tile; 50 categories wrap into the grid without overflow.
- Announcement text longer than one line wraps; dismiss button is a 44px target.
- Hero image 404: gradient shows, no broken-image icon (use `onError` fallback client piece or `next/image` with a CSS background layer beneath).
- Brand or category without handle is skipped.

## Testing

- Unit: `resolveProductSections` (missing, present, order kept), `getNewsletterAction` (unset, http, https, garbage), data helpers' error-to-empty behaviour with a stubbed `sdk`.
- Component (jsdom, Phase 2 harness): each section hides when given empty data; announcement dismiss and persistence failure (throwing storage) does not break; hero without image shows gradient and heading; newsletter form has `action`, `method="post"`, an `email` input and a label; `Reveal` renders children immediately when `IntersectionObserver` is missing.
- Contrast: hero text pairs covered by the existing token test; no new colours.
- Verification (phase end): typecheck, lint, tests, sibling-copy `next build`, bundle secret scan, local run against the backend with and without collections, as in Phase 2; browser screenshots only if a browser tool is available, otherwise reported as not checked.

## Out of scope

Search system and `/search` (Phase 6); `/brands` pages and filters (Phase 4); image optimisation and CDN (Phase 7); a CMS; computing best sellers or trending from orders; newsletter backend or provider choice; creating collections or loading a catalog (owner or Phase 4a import).

## Owner inputs still needed (not blocking the build)

Real store name (`NEXT_PUBLIC_STORE_NAME`), hero image and copy, the collection handles above created in Medusa Admin, a `brands` category with brand children, optional newsletter form URL.
