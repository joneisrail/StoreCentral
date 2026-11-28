# Storefront tech stack

Date: 2026-11-25. Versions read from `apps/storefront/package.json` and the shell.

| Area | Installed | Brief asks for | Note |
|---|---|---|---|
| Framework | Next 15.5.24 | Next.js latest stable | Do not upgrade without a reason; check compatibility first (brief Part 2) |
| UI | React 19.0.5 | React | Icon typing mismatch with `@medusajs/icons` (37 `TS2786` errors) |
| Language | TypeScript ^5.3.2 | TypeScript | Build errors currently ignored |
| Styling | Tailwind ^3.0.23, `@medusajs/ui-preset` | Tailwind | Tailwind 4 is a separate migration; not needed |
| Motion | none | Framer Motion or CSS | CSS transitions first |
| Commerce | `@medusajs/js-sdk` 2.21.2, backend = vendored fork | Medusa Store API | Pin storefront SDK to the fork's version |
| Payments | `@stripe/react-stripe-js` ^5.3, `@stripe/stripe-js` ^8.2 | provider integration | Server-side keys stay in backend |
| Search UI | `react-instantsearch` ^7.46, `instantsearch.js` 4.113, `@medusajs/instantsearch-adapter` 2.21.2 | Meilisearch + autocomplete | Adapter talks to the backend `/store/search`, never to Meilisearch directly |
| Search engine | Meilisearch v1.58.0 via a custom Medusa search provider; `meilisearch` npm client 0.63.0 (backend) | Meilisearch | See `SEARCH_ARCHITECTURE.md` |
| Images | `next/image` with the optimiser on (AVIF, WebP) and a custom loader (`src/lib/image-loader.ts`) | CDN | Cloudflare documented, not configured; see `IMAGES.md` |
| Tests | none | Lighthouse, unit, e2e | To add |
| Runtime | Node v24.18.0, Yarn 3.2.1, Turbo | Node | Docker image per `deploy/storefront.Dockerfile` |
| Data stores | Postgres 15, Redis 7 (compose) | Postgres, Redis | Redis already on for backend modules |

## Likely additions (each justified in its phase, none installed yet)

- `next/font` (built in) for the serif and sans pair.
- Vitest + Testing Library; Playwright for checkout and search.
- A CDN in front of the image host (Cloudflare per the brief).
- Meilisearch: added in Phase 6 (see above).
