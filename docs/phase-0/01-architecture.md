# StoreCentral architecture (Phase 0 snapshot)

Snapshot date 2026-11-22, branch `master` (tracks `origin/main`). Read-only audit; no application code was changed. Facts below come from the repo files, `medusa-config.ts`, package manifests and the running dev machine. Anything not opened in depth is marked "not audited".

## 1. Repository layout

Yarn 3.2.1 workspaces + Turborepo, Node >= 22.22.0, one lockfile (`yarn.lock`).

| Path | What it is | Size / notes |
|---|---|---|
| `apps/backend` (`@dtc/backend`) | Medusa application: custom modules, workflows, API routes, subscribers, admin extensions | 71 module files, 92 workflow files, 49 route files, 10 subscriber files, 3 jobs, 9 links, 61 admin route files |
| `apps/seller-hub` | Separate Node service: marketplace connectors (Shopify, WooCommerce, Amazon), queues, webhooks | 71 test files; deps: bullmq, ioredis, pg, aws-sdk SQS |
| `apps/storefront` | Next.js 15.5 storefront (Medusa DTC starter) | 18 page routes; Stripe keys; has an untracked `CLAUDE.md` |
| `apps/pos` | Point of sale | `server.js` (32 lines) + `index.html`; prototype scale, not audited in depth |
| `packages/core`, `modules`, `medusa`, `plugins`, `cli`, ... | In-repo copy of the Medusa framework, version 2.21.2 | about 6,000 tracked files; the backend depends on it as `workspace:*` |
| `packages/admin/dashboard` | Forked Medusa admin dashboard (has the Channel stock & pricing grid) | built with `yarn build`, served by the backend |
| `docs/superpowers` | 22 specs and 22 plans, plus `SRS-order-management-page.md` | history of every feature slice |

Git: 361 commits on the StoreCentral line (`master` / `origin/main`). `origin/develop` has diverged hugely (master is 361 ahead, 11,008 behind); it is the upstream-style line and is deliberately left alone.

## 2. Runtime topology (dev machine)

```
Browser ---> Storefront (Next.js :8000) ---> Backend (Medusa :9000, admin at /app)
Browser ---> POS (:8001, static)                     |  |  \
                                                      |  |   +-- PostgreSQL :5432 (schema public: Medusa + custom modules)
Backend admin proxy --(SELLER_HUB_INTERNAL_URL/SECRET)--> Seller-hub (:7005)
Backend subscriber ---(SELLER_HUB_WEBHOOK_URL)---------->   |  +-- PostgreSQL schema seller_hub (connections, listings, sync jobs)
                                                            +-- Redis :6379 (BullMQ queues)
                                                            +-- Shopify / WooCommerce REST, Amazon SP-API via AWS SQS
```

- One PostgreSQL server is shared. Medusa uses `public`; seller-hub uses its own `seller_hub` schema.
- Seller-hub holds marketplace credentials encrypted (`ENCRYPTION_KEY`, outside the DB). The internal API between backend and seller-hub is protected by the shared `SELLER_HUB_INTERNAL_SECRET`.
- Marketplace direction: Medusa is the master catalog. Listings link to variants by exact SKU. Orders flow in from channels; price, stock and tracking flow out.

## 3. Backend design

Custom Medusa modules (`apps/backend/src/modules`): `review`, `order-events`, `channel-offers`, `supplier`, `purchase`, `accounting`. Fulfillment module is registered explicitly with the manual provider plus `@dtc/fulfillment-easypost`.

Conventions in use: workflows for every mutation, file-based API routes, Zod validation, subscribers for cross-module reactions, per-variant locking inside the channel-offers workflows, hand-written migration for `channel-offers`.

Admin API areas: channel-offers, channel-stock-settings, expenses, fulfillment-queue, invoices, marketplace-connections, orders, order-search, profit-report, purchases, reviews, sales-channels, sales-report, supplier-balances, supplier-offers, supplier-payments, suppliers.

Admin UI areas: accounting, fulfillment-queue, purchases, reviews, settings (backend `src/admin`), plus the forked dashboard (orders, products, Channel stock & pricing, sales channels with marketplace connection).

## 4. Configuration and data

- `medusa-config.ts` registers only the custom modules and the fulfillment module. No Redis event bus, workflow engine, locking or cache module is configured, and `projectConfig` has no `redisUrl`. `REDIS_URL` is set in `.env` but is used only by seller-hub (BullMQ). Consequence: in the backend, events, workflow state and locks are in-process (single instance only, lost on restart).
- Environment variable names (values not read): backend `DATABASE_URL`, `DB_*`, `REDIS_URL`, `JWT_SECRET`, `COOKIE_SECRET`, `AUTH_MFA_ENCRYPTION_KEY`, CORS trio, `EASYPOST_*`, `SELLER_HUB_*`. Storefront `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`, `..._BACKEND_URL`, `..._DEFAULT_REGION`, `..._BASE_URL`, `..._STRIPE_KEY`. Seller-hub `DATABASE_URL`, `REDIS_URL`, `ENCRYPTION_KEY`, `SELLER_HUB_INTERNAL_SECRET`, AWS settings.
- `.env` files are not tracked by git (checked with `git ls-files`).
- Migrations: Medusa-generated for most modules; `channel-offers` was written by hand (`Migration20261117120000.ts`) and has not been checked with `db:generate` on a scratch DB.

## 5. Deployment structure

None exists in the repo: no Dockerfile, compose file, CI workflows, or hosting config (checked root and depth 3). Everything runs as `yarn dev` processes on a developer machine. `yarn start` builds via Turbo, but no production process model (backend, seller-hub, storefront, POS, workers) is defined anywhere.

## 6. Test and quality tooling

- Backend: Jest unit (48 unit spec files), module integration, 33 HTTP integration suites; needs a live PostgreSQL.
- Seller-hub: Vitest, 71 test files. Dashboard: Vitest. Storefront: no tests (per AGENTS.md).
- Lint: `@medusajs/eslint-plugin` recommended config at the root.
