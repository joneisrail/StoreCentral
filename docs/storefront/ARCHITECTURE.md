# Storefront architecture (current and recommended)

Date: 2026-11-25. Companion to `PROJECT_AUDIT.md`.

## Current

```
Browser -> Caddy (HTTPS) -> Storefront (Next.js 15, :8000, standalone)
                                 |  @medusajs/js-sdk (publishable key)
                                 v
                           Backend (Medusa fork, :9000)  -> Postgres 15, Redis 7
                                 |  /store/search (built-in search framework)
                                 v
                           product search index (defineSearchIndex)
Stripe (browser, publishable key) / Stripe webhook -> backend
```

- Server components fetch through `src/lib/data/*` with `sdk` from `src/lib/config.ts` (adds the locale header).
- Region comes from `middleware.ts` (country to region map cached for an hour).
- Search UI: `react-instantsearch` + `@medusajs/instantsearch-adapter` against `/store/search` (`src/lib/search-client.ts`); navbar drawer and `/store` listing share the client.
- Feature code lives in `src/modules/<feature>/{components,templates}`; shared helpers in `src/lib`.

## Recommended

Keep the structure; extend, do not rebuild (brief rules 1 and 13).

1. **Layout**: keep `src/modules/*` as the feature layout rather than the brief's `components/ features/`; the brief says to adapt to the existing project. Add `modules/brands`, `modules/wishlist`, `modules/fragrance`, `modules/content` (about, contact, policies).
2. **Design layer**: add design tokens (CSS variables in `globals.css` mapped in `tailwind.config.js`), load a serif and a sans through `next/font`, and restyle shared components first (buttons, cards, nav, drawers) so pages inherit.
3. **Fragrance data** (decision needed, see `IMPLEMENTATION_PLAN.md`): product `metadata` for notes, family, gender, concentration; brand as a product category tree or a small backend module with a link to products. Index these in `src/search/product.ts` so they are searchable and facetable.
4. **Search**: stay on Medusa's built-in search unless a gap in the decision below forces Meilisearch. If Meilisearch is chosen, keep the same `/store/search` contract and swap the provider behind it so storefront code does not change.
5. **Images**: done in storefront Phase 7: the Next image optimiser with a custom loader, one configured image origin in `remotePatterns`, aspect-ratio boxes and explicit `sizes`. Blur placeholders and a CDN were not built. See `docs/storefront/IMAGES.md`.
6. **Quality gates**: fix the 37 icon-typing errors, then turn off `ignoreBuildErrors` and `ignoreDuringBuilds`; add Vitest + Testing Library and Playwright for checkout.
7. **Security**: no secret in `NEXT_PUBLIC_*`; Stripe secret and any search admin key stay in the backend.
