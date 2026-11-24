# Storefront Phase 0: project audit

Date: 2026-11-25. Scope: `apps/storefront` and everything it talks to. Read-only audit of the brief in `apps/storefront/CLAUDE.md`; no storefront code was changed. Numbering note: the brief's Phases 0-13 are storefront phases and are unrelated to the platform roadmap's Phases 1-5 in `docs/phase-0/`.

How facts were gathered: file reads, `tsc --noEmit` in `apps/storefront`, and read-only GET/POST calls against the local backend (:9000) with the storefront's publishable key (key value not recorded). Production data was not inspected.

## 1. What exists

- `apps/storefront` is the stock Medusa v2 DTC Next.js starter (`@dtc/storefront` 1.0.3), customised only lightly: country-code URL prefixes and the selector were removed (commit `ee26c97336`), and a store listing with InstantSearch filters was added.
- Next 15.5.24, React 19.0.5, TypeScript 5.3+, Tailwind 3 with `@medusajs/ui-preset`, `@medusajs/js-sdk` 2.21.2, Stripe (`@stripe/react-stripe-js`), `react-instantsearch` 7 and `@medusajs/instantsearch-adapter` 2.21.2. Node v24.18.0, Yarn 3.2.1, monorepo with Turbo.
- Backend is the vendored Medusa fork in `packages/**` plus `apps/backend` (custom modules: review, order-events, channel-offers, supplier, purchase, accounting). Postgres 15 and Redis 7 in `deploy/docker-compose.yml`.
- Deployment: `deploy/storefront.Dockerfile`, compose stack, Caddy, CI (`.github/workflows/ci.yml` lints the storefront and builds its image).

### Routes (page.tsx / route.ts)

`/`, `/store`, `/products/[handle]`, `/collections/[handle]`, `/categories/[...category]`, `/cart`, `/checkout`, `/account` (dashboard, orders, order details, profile, addresses, login), `/order/[id]/confirmed`, `/order/[id]/transfer/...`, `/verify-account`, `/api/payment-return`. All sit under a `[countryCode]` segment; the middleware resolves region from the country.

## 2. Gap against the brief's routes

| Brief route | State |
|---|---|
| `/`, `/products/[handle]`, `/collections/[handle]`, `/categories/[handle]`, `/cart`, `/checkout`, `/account`, `/account/orders`, `/account/profile` | Exist (starter versions) |
| `/collections` (index) | Missing (`/store` lists everything) |
| `/brands`, `/brands/[handle]` | Missing; no brand concept in the data model |
| `/search` | Missing; search is a navbar drawer plus the `/store` listing |
| `/wishlist` | Missing; no wishlist data or module |
| `/about`, `/contact`, `/policies/*` | Missing |

## 3. Findings and risks

| # | Severity | Finding | Evidence |
|---|---|---|---|
| S1 | High | The brief assumes Meilisearch; the repo does not use it. Search is Medusa's built-in search framework: backend `src/search/product.ts` (`defineSearchIndex`), `/store/search` via `configureStoreSearch` in `src/api/middlewares.ts`, storefront `src/lib/search-client.ts` through `@medusajs/instantsearch-adapter`. No Meilisearch reference in backend source, `medusa-config.ts` or the compose file. | files above |
| S2 | High | The product index cannot answer the brief's search spec. Indexed fields: id, title, description, handle, thumbnail, created_at, category, labels (tags), option_values, prices in eur/usd. Not indexed: brand, SKU, gender, fragrance family, notes, concentration. | `src/search/product.ts` |
| S3 | High | No fragrance data model. Local products have empty `metadata`; no brand, notes, family, gender or concentration anywhere in backend source. The brief forbids inventing these, so the source of truth must be decided first. | local API probe; grep of `apps/backend/src` |
| S4 | Medium | The local catalog is Medusa demo data: 4 clothing products, 4 clothing categories, 0 collections, 1 region (United States, usd, 1 country). Real catalog size and shape are unknown; Phase 1 acceptance needs it. | local API probe |
| S5 | Medium | Build gates are off: `typescript.ignoreBuildErrors: true` and `eslint.ignoreDuringBuilds: true` in `next.config.js`. `tsc --noEmit` reports 37 errors, all `TS2786` ("icon cannot be used as a JSX component"), a React 19 type mismatch with `@medusajs/icons`, so real type errors would also be hidden today. | `next.config.js`, tsc run |
| S6 | Medium | Images are unoptimised: `images.unoptimized: true`; `remotePatterns` allow only localhost and S3 hosts; no CDN; `next/image` used in 4 files. None of the brief's Phase 7 is in place. | `next.config.js` |
| S7 | Medium | No tests for the storefront. CI only lints and builds the image. | file search; `ci.yml` |
| S8 | Medium | Design system is the Medusa starter: `ui-preset`, grey scale, Inter-style sans, no serif, no fonts loaded in `layout.tsx`, no ivory/charcoal/champagne tokens. Phase 2 is a rebuild of the visual layer, not an extension. | `tailwind.config.js`, `layout.tsx` |
| S9 | Low | Region defaults: `.env.template` and middleware fall back to `dk`; the only backend region is US/usd. Worth aligning before Phase 1 sign-off. | `.env.template`, `middleware.ts` |
| S10 | Low | `NEXT_PUBLIC_*` variables are bundled to the browser. That is correct for the publishable key and Stripe publishable key; confirm nothing else secret is ever given that prefix. | `.env` names only |
| S11 | Info | Reviews exist as a backend module and a `/store/reviews` route, which can serve the brief's Phase 5 reviews. | `apps/backend/src/modules/review`, `src/api/store/reviews` |

## 4. What is in good shape

- Cart, checkout, Stripe payment return, accounts, order history and transfer flows come from the maintained starter and talk to real Medusa APIs.
- Search plumbing end to end already works in principle (index definition, `/store/search`, adapter, refinements, price range, on-sale toggle).
- Deployment path exists (Dockerfile, compose, Caddy, CI, env check).
- Reviews backend exists.

## 5. Not verified

- Real production catalog, images and hosting, payment provider setup, Stripe test checkout, live search results (my one probe used the wrong request shape and was rejected with "Field 'queries' is required"; the endpoint itself is up), Lighthouse numbers, and whether the `[countryCode]` segment still resolves correctly after the prefix removal.
