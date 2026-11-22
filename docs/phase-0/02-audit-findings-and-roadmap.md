# Phase 0 audit: findings, risks, gaps and roadmap

Companion to `01-architecture.md`. Severity: High = can lose data or block production, Medium = will bite soon, Low = tidy up.

## 1. Risks

| # | Sev | Finding | Evidence | Suggested fix |
|---|---|---|---|---|
| R1 | High | No deployment definition or CI. Nothing describes how backend, seller-hub, storefront, POS and workers run outside a dev machine; no automated test gate. | No Dockerfile, compose, `.github/workflows` or host config found. | Phase 1: define the production process model, Dockerfiles, env contract, CI (lint + unit tests). |
| R2 | High | Backend uses in-process event bus, workflow engine and locks. The per-variant stock locks and `channel-offer.changed` events only work for one backend process and are lost on restart or crash. | `medusa-config.ts` registers no Redis modules and no `redisUrl`; only seller-hub uses Redis. | Configure `event-bus-redis`, `workflow-engine-redis`, `locking-redis` (the packages exist in-repo) before running more than one instance or any real traffic. |
| R3 | High | Medusa framework is vendored (about 6,000 tracked files, 2.21.2) and the admin dashboard is forked. Upstream security and bug fixes must be merged by hand; `origin/develop` has diverged by 11,008 commits. | `packages/**` tracked; `git rev-list` counts. | Decide: keep the fork (document a merge procedure and owner) or move to published `@medusajs/*` packages plus an admin extension. Biggest strategic decision. |
| R4 | High | Tests write into the dev database. The dev `seller_hub.integration_account` holds a large number of credential-less Amazon rows from test runs (query output exceeded 600 KB). | Observed while diagnosing the WooCommerce connection. | Point test runs at a separate database; clean the test rows (needs confirmation before deleting); add a guard that refuses tests on the dev DB. |
| R5 | Med | `channel-offers` migration is hand-written and unverified; the one-time stock split has not been applied to the dev DB. | Spec rollout notes; split `apply` not run. | Verify on a scratch DB (`db:migrate`, `db:generate` no diff, `db:rollback` once); then run `apply` in a quiet period. |
| R6 | Med | Secrets hygiene unknown beyond names. Secret strengths (JWT, cookie, MFA key, encryption key) were not inspected by design; dev uses the same Postgres user for everything. | `.env` names only. | Phase 1: secret inventory, rotation plan, per-service DB roles, production values from a secret store. |
| R7 | Med | Known failing or flaky tests: seller-hub `admin-client.test.ts` reads the real local backend, `queues.test.ts` timing flake, 3 dashboard combobox failures, 3 eslint errors in `orders-carrier-rates.spec.tsx`. | Last regression run. | Make the tests hermetic; fix lint errors. |
| R8 | Med | Dev machine runs out of memory when all five processes run; the harness stops them. Production sizing is unknown. | Repeated low-memory stops this session. | Measure per-process memory; set limits; consider building the dashboard once instead of running Vite in dev. |
| R9 | Med | POS is a 32-line static server with no visible link to Medusa orders, stock or channels. Web and POS stock is allocation-only; checkout does not enforce channel stock. | `apps/pos` contents; channel pricing spec "Deferred". | Define POS scope before more channel logic depends on it. |
| R10 | Low | Untracked `apps/storefront/CLAUDE.md`; mixed old and new docs layout (`docs/superpowers` only). | `git status`. | Commit or ignore; index docs. |

## 2. Missing or incomplete functionality

Relative to the stated direction (one backoffice for several sales channels):

1. **Product import from a channel.** Today only SKU linking exists, Medusa-to-channel; no importer. First sync overwrites the channel.
2. **Amazon live.** SP-API and SQS code exists but AWS credentials and queue are not set up; per-channel push for Amazon is deferred.
3. **Marketplace connection UX.** Saving WooCommerce credentials needs seller-hub running and the shared secret; the admin gives little guidance when seller-hub is down. No sync-status screen.
4. **Channel stock enforcement for web and POS** (allocation only), returns restoring channel stock, per-product override of the share-stock switch.
5. **Base price changes** in Medusa do not propagate to channels for variants that have offers (manual sync icon only).
6. **Reports per channel**, roles and permissions (the `rbac` module exists in the framework but is not configured), other locales.
7. **Operations:** backups, monitoring, error alerting, log aggregation, health checks for seller-hub, a runbook.
8. **Open item:** unconfirmed draft-orders `useExtension` fix.

## 3. What is in good shape

- Consistent spec to plan to review discipline: 22 specs, 22 plans, large automated test base (backend 48 unit specs plus 33 HTTP suites; seller-hub 71 test files).
- Business logic sits in workflows with idempotency refs and locks; credentials are encrypted and never logged.
- Clear separation: Medusa as master catalog, seller-hub as the only code that talks to marketplaces.

## 4. Proposed roadmap

| Phase | Goal | Contents | Exit check |
|---|---|---|---|
| 1 | Make it deployable and safe | R1, R2, R4, R6, R8: Dockerfiles and process model, Redis modules, CI, separate test DB, secret inventory, health checks | Fresh machine boots all services from docs; CI green |
| 2 | Close known debt | R5, R7, R10: verify migration, apply stock split, fix flaky and failing tests, lint errors | Full regression green without known exceptions |
| 3 | Decide the Medusa fork strategy | R3: either a documented upstream merge procedure or migration to published packages | Written decision and owner |
| 4 | Channel completeness | Product import and mapping, sync-status screen, base-price propagation, Amazon go-live | Each behind its own spec and plan |
| 5 | Selling surfaces | POS scope and integration, web and POS stock enforcement, reports per channel, roles | Per-feature specs |

Phase 3 can run in parallel with 1 and 2. Phases 4 and 5 follow the existing spec, plan, subagent workflow.

## 5. Decisions needed from you before Phase 1

1. Keep the vendored Medusa fork (and maintain it) or plan a move to published packages?
2. Target hosting for production (single VPS with Docker, a PaaS, or Kubernetes)?
3. Phase order: is deployability (Phase 1) really first, or do you prefer channel features (Phase 4) first?
4. May I clean the test rows from the dev `seller_hub.integration_account` (R4)?
