# Storefront Phase 3: Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the starter homepage with the brief's 18-section premium homepage that renders only real Medusa data and hides any section whose data is missing.

**Architecture:** Static content (hero, announcement, promos, editorial) lives in one typed file. Product, brand and category sections are async server components, each in its own `Suspense`, fed by small server data helpers that return empty lists on any failure. Pure resolver functions decide which sections exist, so they are unit-tested without a network.

**Tech Stack:** Next 15.5, React 19.0.5, Tailwind 3 with the Phase 2 tokens, `next/image`, Vitest 4 with jsdom and the Phase 2 harness (`src/test/render.tsx`).

**Spec:** `docs/superpowers/specs/2026-11-25-storefront-phase-3-homepage-design.md`

## Global Constraints

- Work only in `apps/storefront`, plus `deploy/`, `README.md`, `docs/ops/secrets.md` and `docs/storefront/` for the one new variable and the doc. Style: no semicolons in new code, double quotes, 2-space indent, kebab-case files, no emojis (repo `AGENTS.md`). Keep an edited file's existing line endings (many are CRLF) and keep every file valid UTF-8 (`src/test/encoding.test.ts` guards it; use entities such as `&copy;`, never lone Latin-1 bytes).
- No mock products anywhere in production code. Fixtures appear only in tests. A section renders only when its data exists; a failed fetch hides that section and never throws to the error boundary.
- Collection handles (exact): `best-sellers`, `trending`, `mens`, `womens`, `unisex`, `arabic`, `niche`. New arrivals = 8 latest products by `created_at`, no collection. Brands = child categories of the top-level category with handle `brands`. Page section order: announcement bar, nav, hero, shop by category, featured brands, best sellers, new arrivals, trending, men's, women's, unisex, Arabic, niche, promotional campaigns, editorial, newsletter, footer.
- Newsletter renders only when `NEXT_PUBLIC_NEWSLETTER_ACTION_URL` parses as an `https:` URL; it is a plain HTML form (`method="post"`, `action` that URL, one `email` input with a label). The variable is optional and non-secret. Client components cannot read `process.env` dynamically, so server components read it and pass it down as a prop.
- Tailwind 3 cannot apply alpha modifiers to the CSS-variable token colours; use explicit values such as `bg-[rgb(30_29_27/0.4)]`.
- Phase 2 rules apply to everything new: gold is never body text (use `gold-deep`), focus ring `focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2` (or the outline equivalent used in the nav), touch targets at least 44px below 1024px (`min-h-[44px] lg:min-h-0`), motion only under `motion-safe:` or with `motion-reduce:transition-none`, AA text contrast, existing `data-testid` values unchanged.
- Do not install packages. Tests: Vitest, jsdom per file via `// @vitest-environment jsdom`, `afterEach(cleanup)` (not manual calls), polyfills for headless-ui only where a test needs it (see `drawer.test.tsx`). Each task ends with `npx vitest run`, `npx tsc --noEmit` and `npx next lint` in `apps/storefront` green (lint needs `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_test NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://localhost:9000`).
- `next build` fails inside a worktree nested under the repo (known). Final verification builds a copy outside the worktree (Task 7). Worktree `node_modules` are directory junctions already in place; never `ln -s`, never a full `yarn install`.

## Review Focus

- A collection that exists but has no products must hide its section, not show a heading with an empty grid (Task 4).
- The whole data layer failing (backend down, region missing) must still render the hero and static sections with no thrown error (Tasks 2 and 5).
- Fifty categories, and category or collection titles of 80 characters, must wrap inside their tiles without overflowing the grid (Task 4).
- A missing or failing hero image must show the palette gradient with readable heading text and no broken-image icon (Task 3).
- The announcement dismissal when `sessionStorage` throws, and `Reveal` without `IntersectionObserver` or under reduced motion, must leave content visible (Task 3).

---

### Task 1: Content, section map, newsletter URL and env plumbing

**Files:**
- Create: `apps/storefront/src/lib/content/homepage.ts`, `apps/storefront/src/lib/content/homepage-sections.ts`, `apps/storefront/src/lib/content/homepage.test.ts`
- Modify: `apps/storefront/.env.template`, `deploy/storefront.Dockerfile`, `deploy/docker-compose.yml`, `deploy/.env.example`, `README.md` (storefront variable list near line 153), `docs/ops/secrets.md` (storefront variable table)

**Interfaces:**
- Produces in `homepage.ts`: `type Img = { src: string; alt: string }`; `type HeroContent = { eyebrow?: string; headline: string; subheadline?: string; cta?: { label: string; href: string }; image?: Img }`; `type Promo = { id: string; title: string; text?: string; href: string; ctaLabel: string; image?: Img }`; `type EditorialBlock = { id: string; title: string; text: string; href?: string; linkLabel?: string; image?: Img }`; `type HomepageContent = { description: string; announcement: { text: string; href?: string } | null; hero: HeroContent; promos: Promo[]; editorial: EditorialBlock[] }`; `const homepageContent: HomepageContent` with defaults: description `"Fine fragrance, delivered."`, announcement `null`, hero headline `"Discover your signature scent"` with cta `{ label: "Shop all", href: "/store" }` and no image, `promos` and `editorial` empty arrays; `getNewsletterAction(env?: Record<string, string | undefined>): string | null` (default `process.env`; trimmed value returned only if `new URL(value).protocol === "https:"`, else `null`; never throws).
- Produces in `homepage-sections.ts`: `type SectionDef = { id: string; title: string; kind: "collection"; collectionHandle: string } | { id: "new-arrivals"; title: string; kind: "latest" }`; `const PRODUCT_SECTIONS: SectionDef[]` in page order (best-sellers "Best sellers", new-arrivals "New arrivals", trending "Trending fragrances", mens "Men's collection", womens "Women's collection", unisex "Unisex collection", arabic "Arabic fragrances", niche "Niche fragrances"); `type ResolvedSection = { id: string; title: string; kind: "collection"; collection: { id: string; handle: string } } | { id: "new-arrivals"; title: string; kind: "latest" }`; `resolveProductSections(defs: SectionDef[], collections: { id: string; handle: string }[]): ResolvedSection[]` (keeps order, drops collection sections whose handle is absent, always keeps `latest`).

- [ ] **Step 1: Write `homepage.test.ts`** (node env): `resolveProductSections(PRODUCT_SECTIONS, [])` returns only `new-arrivals`; with collections `niche` and `best-sellers` it returns `best-sellers`, `new-arrivals`, `niche` in that order and the `collection.id` of each; unknown extra collections are ignored; `PRODUCT_SECTIONS` ids are unique and the seven collection handles equal the Global Constraints list; `getNewsletterAction` returns `null` for unset, blank, `http://x.test/f`, `not a url`, `javascript:alert(1)`, and `"https://x.test/f"` for `" https://x.test/f "`.
- [ ] **Step 2: Run `npx vitest run src/lib/content`, expect FAIL** (modules missing).
- [ ] **Step 3: Implement both modules** per Interfaces.
- [ ] **Step 4: Env plumbing** for `NEXT_PUBLIC_NEWSLETTER_ACTION_URL` (optional, empty default, comment "https form action of the email provider; section hidden when empty"): `.env.template`, `storefront.Dockerfile` (ARG and ENV beside `NEXT_PUBLIC_STORE_NAME`), compose (build arg and environment as `"${NEXT_PUBLIC_NEWSLETTER_ACTION_URL:-}"`), `deploy/.env.example`, the two docs rows. Run `node --test deploy/*.test.mjs` from the repo root and fix any expectation that enumerates storefront variables.
- [ ] **Step 5: Run tests, typecheck, lint; commit** `feat(storefront): homepage content, section map and newsletter env`.

### Task 2: Server data helpers

**Files:**
- Create: `apps/storefront/src/lib/data/homepage.ts`, `apps/storefront/src/lib/data/homepage.test.ts`
- Modify: none

**Interfaces:**
- Consumes: `listProducts` (`@lib/data/products`), `listCollections` (`@lib/data/collections`), `listCategories` (`@lib/data/categories`), `getRegion` (`@lib/data/regions`), `resolveProductSections` and `PRODUCT_SECTIONS` (Task 1).
- Produces: `type TileCategory = { id: string; name: string; handle: string; imageUrl: string | null }`; pure `pickBrands(categories: HttpTypes.StoreProductCategory[]): TileCategory[]` (children of the category with handle `brands`; skips children without a handle; `[]` if no `brands` category); pure `pickShopCategories(categories): TileCategory[]` (top-level categories, meaning no `parent_category_id`, except `brands`; skips entries without a handle; `imageUrl` from `metadata.image_url` when it is an https URL string, else `null`); server functions, each returning an empty result on any thrown error after one `console.error("homepage: <name> failed")` (no payload): `getHomepageSections(countryCode: string): Promise<{ region: HttpTypes.StoreRegion; sections: ResolvedSection[] } | null>` (null when the region or collections cannot be loaded), `listSectionProducts(section: ResolvedSection, regionId: string, limit?: number): Promise<HttpTypes.StoreProduct[]>` (limit default 8; `latest` uses `order: "-created_at"`; collection uses `collection_id`; both request `fields: "*variants.calculated_price"`), `listBrandTiles(): Promise<TileCategory[]>`, `listShopTiles(): Promise<TileCategory[]>` (both call `listCategories({ fields: "id,name,handle,parent_category_id,metadata,*category_children" })` once).

- [ ] **Step 1: Write `homepage.test.ts`**: `pickBrands` with no `brands` category gives `[]`, with `brands` having two children plus one handle-less child gives two tiles; `pickShopCategories` excludes `brands`, excludes categories with a `parent_category_id`, maps `metadata.image_url` only for https strings (an `http://` value and a number give `null`); with `vi.mock` of the three data modules: `listSectionProducts` returns `[]` when `listProducts` rejects and calls it with `order: "-created_at"` for `new-arrivals`; `getHomepageSections` returns `null` when `getRegion` resolves `null` and when `listCollections` rejects, and returns the resolved list otherwise; `listBrandTiles` returns `[]` when `listCategories` rejects. Suppress `console.error` in those tests with a spy.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** per Interfaces (`"use server"` is not needed; keep it a plain server-side module importing the existing data helpers).
- [ ] **Step 4: Run tests, typecheck, lint; commit** `feat(storefront): homepage data helpers`.

### Task 3: Reveal, announcement bar and hero

**Files:**
- Create under `apps/storefront/src/modules/home/components/`: `reveal/index.tsx`, `reveal/reveal.test.tsx`, `announcement-bar/index.tsx`, `announcement-bar/announcement-bar.test.tsx`, `hero/hero.test.tsx`
- Modify: `hero/index.tsx` (replace the starter hero entirely)

**Interfaces:**
- Consumes: `HeroContent`, `Img` (Task 1); `Heading`, `Text`, `Button` from `@modules/common/components/ui`; `LocalizedClientLink`.
- Produces: `Reveal({ children, className? })` client component (wraps children in a `div`; content is visible by default; when `IntersectionObserver` exists and `window.matchMedia("(prefers-reduced-motion: reduce)").matches` is false it adds `motion-safe` fade and rise classes once the element enters the viewport; with no `IntersectionObserver`, or reduced motion, it renders plain children with no hidden state at any time; must never leave content at `opacity-0` after an observer error). `AnnouncementBar({ text, href? }: { text: string; href?: string })` client component: a charcoal band with ivory text, optional link, a 44px dismiss button labelled "Dismiss announcement"; dismissal is stored under `sessionStorage` key `sc-announcement-dismissed:<text>`; every storage read and write is in try/catch, so a throwing storage still lets the bar render and dismiss for the session. `Hero({ content }: { content: HeroContent })` server component: `data-testid="home-hero"`, ivory-to-line gradient background with `min-h` and an aspect box so layout never shifts, serif `h1` headline, optional eyebrow and subheadline and `Button` link; when `content.image` exists it renders `next/image` with `fill`, `priority`, `sizes="100vw"`, the given `alt`, `object-cover`, layered under a gradient scrim so text keeps contrast, and the image sits in a client-safe wrapper that hides the `<img>` on load error (`onError`), leaving the gradient. Without an image only the gradient and text render.

- [ ] **Step 1: Write the tests** (jsdom): Reveal renders children immediately with `IntersectionObserver` deleted from `globalThis`, and with `matchMedia` reporting reduced motion; Reveal with a stub observer that throws on construction still shows children; AnnouncementBar renders text and link, dismiss removes it and writes the key, a `sessionStorage` whose `getItem` and `setItem` throw still renders and still dismisses, a previously stored dismissal renders nothing; Hero renders the `h1`, the CTA link `href`, and with no image has no `img` element; Hero with an image renders an `img` with the alt text and, after firing `error` on it, no `img` remains while the headline is still present; a 200-character headline renders (no throw).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the three components per Interfaces; `next/image` needs `unoptimized` handled by the existing config, and `src` may be a local path or an https URL.
- [ ] **Step 4: Run tests, typecheck, lint; commit** `feat(storefront): hero, announcement bar and reveal`.

### Task 4: Content sections

**Files:**
- Create under `apps/storefront/src/modules/home/components/`: `product-section/index.tsx`, `product-section/product-section.test.tsx`, `category-grid/index.tsx`, `brand-strip/index.tsx`, `tile-sections.test.tsx`, `promo-banners/index.tsx`, `editorial/index.tsx`, `newsletter/index.tsx`, `static-sections.test.tsx`

**Interfaces:**
- Consumes: `TileCategory` (Task 2), `Promo`, `EditorialBlock` (Task 1), `Reveal` (Task 3), `ProductCardView` and `getProductPrice` as used by `ProductPreview` (`@modules/products/components/product-preview`, `@lib/util/get-product-price`), `LocalizedClientLink`, `Heading`.
- Produces: `ProductSection({ title, viewAllHref, products }: { title: string; viewAllHref?: string; products: HttpTypes.StoreProduct[] })` server-compatible component: returns `null` when `products` is empty; otherwise a `section` with serif heading, an optional "View all" link, and a grid of `ProductCardView` (2 columns on phones, 4 from `lg`) mapped exactly as `ProductPreview` maps a product; wrapped in `Reveal`. `CategoryGrid({ categories }: { categories: TileCategory[] })` and `BrandStrip({ brands }: { brands: TileCategory[] })`: each returns `null` for an empty list; tiles link to `/categories/<handle>` (verify against the footer category links and the `categories/[...category]` route first and use the same shape); long names wrap (`break-words`, `min-w-0`); tiles with `imageUrl` show it with fixed aspect, others are typographic on `bg-paper` with a `line` border. `PromoBanners({ promos }: { promos: Promo[] })` and `Editorial({ blocks }: { blocks: EditorialBlock[] })`: each returns `null` for an empty list. `Newsletter({ action }: { action: string | null })`: returns `null` when `action` is null; else a section with heading, a labelled `email` input (`type="email"`, `required`, `autoComplete="email"`) and a submit `Button`, in a `<form method="post" action={action}>`; no client JavaScript and no `fetch`.

- [ ] **Step 1: Write the tests**: ProductSection with `[]` renders nothing (container empty); with two fixture products renders two `product-wrapper` elements, the heading text and the "View all" link `href`; an 80-character title renders inside the clamp (assert `line-clamp-2` on `product-title`); a product with no variants prices renders without a price element and without throwing; CategoryGrid and BrandStrip render nothing for `[]`, render 50 tiles with unique links, and a tile with an 80-character name keeps `break-words` and `min-w-0`; a tile with `imageUrl` renders an `img` with fixed aspect class, one without renders none; PromoBanners, Editorial render nothing for `[]` and one block each otherwise; Newsletter returns nothing for `null`, and for `"https://x.test/f"` renders a form with `method` `post`, that `action`, an input named `email` that has an associated label.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the components per Interfaces, styled with the Phase 2 tokens (ivory page, paper tiles, serif headings, `py-12 small:py-24` section rhythm as in the old `ProductRail`).
- [ ] **Step 4: Run tests, typecheck, lint; commit** `feat(storefront): homepage sections`.

### Task 5: Compose the page, mount the bar, nav search field

**Files:**
- Create: `apps/storefront/src/modules/home/templates/home-sections.tsx`, `apps/storefront/src/modules/home/templates/home-skeleton.tsx`, `apps/storefront/src/modules/home/templates/home-sections.test.tsx`, `apps/storefront/src/modules/layout/components/search/search-field.test.tsx`
- Modify: `apps/storefront/src/app/[countryCode]/(main)/page.tsx`, `apps/storefront/src/app/[countryCode]/(main)/layout.tsx` (mount `AnnouncementBar` above `Nav` when `homepageContent.announcement` is set), `apps/storefront/src/modules/layout/components/search/index.tsx`; delete `apps/storefront/src/modules/home/components/featured-products/` if nothing else imports it (grep first)

**Interfaces:**
- Consumes: Tasks 1 to 4.
- Produces: `HomeSections({ countryCode }: { countryCode: string })` async server component: calls `getHomepageSections`; when it returns `null` renders `null`; otherwise renders in page order inside the page: `CategoryGrid`, `BrandStrip` (each fed by `listShopTiles` and `listBrandTiles` inside their own `Suspense`), then one `Suspense` per resolved section whose child is an async `SectionProducts` that calls `listSectionProducts` and renders `ProductSection` (view-all link `/collections/<handle>` for collections and `/store` for new arrivals), then `PromoBanners`, `Editorial`, `Newsletter` with `getNewsletterAction()`. `home-skeleton.tsx` exports `ProductSectionSkeleton` (heading bar plus four `SkeletonImage` cards in the same grid and the same vertical padding, so height matches) and `TileSkeleton`. The page: `export const metadata` with `title` from `getStoreName()` and `description` from `homepageContent.description` (computed in `generateMetadata` if the title needs the function); renders `<Hero content={homepageContent.hero} />` first, then `<Suspense fallback={<ProductSectionSkeleton />}><HomeSections countryCode={countryCode} /></Suspense>`. The `Search` client component gains a second trigger, `data-testid="nav-search-field"`, a field-styled button (magnifier icon, text "Search products", `hidden small:flex`, 44px high, line border, paper background) that calls the same `open`; the existing icon button gains `small:hidden` and keeps `data-testid="nav-search-button"` and its `aria-label`.

- [ ] **Step 1: Write the tests**: `HomeSections` with every data module mocked to fail returns an empty render and does not throw; with a mocked region and sections `[new-arrivals]` and products returned, it renders one `ProductSection` (heading "New arrivals"); with `listSectionProducts` returning `[]` that section is absent; search-field test: clicking `nav-search-field` and clicking `nav-search-button` each open the drawer dialog (mock `@lib/search-client`, polyfill as in `drawer.test.tsx`), and both triggers carry an accessible name.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** per Interfaces. Async server components are not renderable in jsdom: test `HomeSections` by awaiting the function and rendering its returned element tree where the children are plain components, or extract the pure ordering into a small helper (`planHomeSections`) that the test calls; choose whichever keeps the test meaningful and say which in the report.
- [ ] **Step 4: Run tests, typecheck, lint; commit** `feat(storefront): compose homepage and nav search field`.

### Task 6: Documentation

**Files:**
- Create: `docs/storefront/HOMEPAGE.md`
- Modify: `docs/storefront/DESIGN_SYSTEM.md` (one line linking to the homepage doc is enough)

**Interfaces:**
- Produces: a doc covering: the section map in page order with each section's data source and when it hides; the exact collection handles and the `brands` category convention, with owner setup steps in Medusa Admin; the optional category `metadata.image_url`; the content file fields (`homepageContent`) with how to set an announcement, hero image and copy, promos and editorial blocks; the newsletter variable and what form field name the provider receives; how to add a new product section (one `PRODUCT_SECTIONS` entry); failure behaviour; what is deliberately not done (search system, `/brands` pages, ranking from orders, image CDN).

- [ ] **Step 1: Write the doc** from the implemented code (read the files; do not describe anything not built). **Step 2:** `npx vitest run src/test/encoding.test.ts`. **Step 3: Commit** `docs(storefront): homepage guide`.

### Task 7: Whole-phase verification

**Files:**
- Modify: `docs/storefront/HOMEPAGE.md` (append a `## Verification results` section); fixes only otherwise, one commit per fix

- [ ] **Step 1:** In `apps/storefront`: `npx tsc --noEmit` (0 errors), `npx next lint` (no errors), `npx vitest run` (all pass); from the repo root `node --test deploy/*.test.mjs` (all pass).
- [ ] **Step 2:** Copy `apps/storefront` (excluding `node_modules`, `.next`) to `apps/sf-buildtest` in the main checkout (outside the worktree), rename its package to `@dtc/sf-buildtest` writing `package.json` without a BOM, junction its `node_modules` to `apps/storefront/node_modules` of the main checkout, build with the real local publishable key from `apps/storefront/.env` (never print it) plus `NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://localhost:9000 NEXT_PUBLIC_DEFAULT_REGION=us NEXT_PUBLIC_BASE_URL=http://localhost:8002 NEXT_PUBLIC_STORE_NAME="Maison Test"`. Expect exit 0.
- [ ] **Step 3:** Scan `.next/static` for `sk_live`, `sk_test`, `whsec_` (none). Run `node .next/standalone/apps/sf-buildtest/server.js` with `PORT=8002 HOSTNAME=localhost`; request `/us`, `/us/store`, `/us/cart`: all 200; the home HTML contains the custom store name, no "Medusa Store", the hero testid, and no product sections other than those backed by data (with the 4 demo products expect new arrivals and shop-by-category only; confirm no section heading for a missing collection appears).
- [ ] **Step 4:** Stop the server (kill the node process by port 8002 and any `sf-buildtest` node process), delete the junction with `[System.IO.Directory]::Delete` first, then the copy.
- [ ] **Step 5:** Browser screenshots at 390px and 1280px only if a browser tool is available; otherwise write that in the results. Append exact counts and what was not checked to `docs/storefront/HOMEPAGE.md`; commit `docs(storefront): phase 3 verification`.
