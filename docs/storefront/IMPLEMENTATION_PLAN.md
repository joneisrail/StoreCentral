# Storefront implementation plan

Date: 2026-11-25. Status: proposal, waiting for owner approval before Phase 1 (brief Part 8). Each phase follows spec, plan, subagent-driven implementation, review; none moves on with unresolved critical errors.

## Decisions needed before Phase 1

1. **Search engine.** (a) Keep Medusa's built-in search and extend the index with brand, SKU, family, notes, gender and concentration (recommended: already wired, no new service, typo tolerance to be verified in Phase 6); or (b) add Meilisearch as the brief says (new service, indexing subscriber, reindex job, deploy config). Unknown until tested: typo tolerance, synonyms, SKU search and prefix matching in the built-in engine. Phase 6 starts with a short spike to decide.
2. **Fragrance attributes.** Where brand, notes, family, gender, concentration live. Recommended: product `metadata` (typed keys) for notes, family, gender, concentration; brand as a product category tree or a thin brand module. You supply the real catalog and the allowed values so nothing is invented.
3. **Catalog source.** Local data is 4 demo products. Phase 1 acceptance needs a realistic catalog (import via the Phase 4a channel import, or a CSV).
4. **Market.** US only, usd. Remove the `dk` fallback.
5. **Images.** Where the originals are hosted, and whether Cloudflare is the CDN.
6. **Visual direction.** Approve the palette and a serif/sans pair, or give references.

## Phases (the brief's numbering)

| Phase | Work | State | Notes from the audit |
|---|---|---|---|
| 0 | Audit and docs | Done (this folder) | Waiting on approval |
| 1 | Foundation | Mostly present | Fix the 37 icon-type errors, re-enable build gates, region defaults, shared types, error handling, env check; add storefront test setup |
| 2 | Design system | Not started | Tokens, fonts, buttons, cards, nav, drawers, modals, skeletons, toasts; restyle the starter components |
| 3 | Homepage | Starter hero and featured rail | Sections 1-18 from real collections; needs the catalog and collections |
| 4 | Catalog | `/store` listing with filters exists | Add brand, gender, family, note, availability filters (needs index fields), URL params, list toggle, wishlist |
| 5 | Product page | Starter PDP | Notes, specs, reviews (backend review module exists), recently viewed, SEO metadata |
| 6 | Search | Built-in search wired | Index extension, `/search` page, autocomplete, popular/recent searches, keyboard nav, `docs/SEARCH_ARCHITECTURE.md` |
| 7 | Images | Unoptimised | Optimisation, CDN, blur placeholders, cache headers, CLS fixes |
| 8 | Cart and checkout | Starter flow, Stripe | Test with the real provider; never simulate payment |
| 9 | Customer experience | Accounts, orders, addresses exist | Add wishlist, recently viewed, order tracking |
| 10 | Fragrance discovery | Not started | Family pages and finder from real metadata |
| 11 | SEO and AI search | Partial (sitemap config file exists) | JSON-LD, canonical, brand and collection pages |
| 12 | Performance and testing | Not started | Lighthouse, a11y, e2e; reports in `docs/` |
| 13 | Production deployment | Dockerfile, compose, Caddy, CI exist | Add search service if chosen, CDN, monitoring, `docs/DEPLOYMENT.md` |

## Required dependencies (proposed)

Vitest, Testing Library, Playwright (dev only); Meilisearch client only if decision 1 is (b). Nothing else is needed up front.

## Risks to carry

S1-S3 and S5-S6 in `PROJECT_AUDIT.md`.
