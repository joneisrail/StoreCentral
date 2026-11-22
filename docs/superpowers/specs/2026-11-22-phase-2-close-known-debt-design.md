# Phase 2: close known debt

Follows `docs/phase-0/02-audit-findings-and-roadmap.md` (risks R5, R7, R10) and `deploy/ci-known-failures.md` (every entry there is removed in this phase).

## Purpose and decisions

Leave the repository with a CI run that has no excluded or "known flaky" tests, a verified migration, and no leftover lint errors, so later phases start from green.

**Intended outcome:** `deploy/ci-known-failures.md` is deleted because nothing is excluded; the full CI workflow (lint, backend unit and integration, seller-hub, dashboard, deploy-config, images) passes; the `channel-offers` migration is proven against a scratch database; the stock split has a documented, owner-run procedure.

Defaults taken from "take all recommended" (change any of them at spec review):

| Question | Decision |
|---|---|
| Who touches the dev database? | Nobody automated. The stock split `apply` and any dev-DB write stay the owner's explicit call (standing rule). |
| Scratch database for the migration check | Needs a database on a Postgres server. Docker is not installed here, so the only server is the local one that also holds the dev database. The check runs only in a NEW, empty database whose name ends in `_scratch_test`, created and dropped by the check itself, and only after the owner says go (gate G1 below). |
| First CI run results | I cannot read GitHub (`gh` is not signed in). The owner pastes the failing job names and logs; fixing whatever the first run reports is Task 1 of the plan and its scope is exactly those failures. |
| Dashboard tests in CI | Added as one job once the 3 combobox failures are fixed, running the whole dashboard unit suite. |
| `apps/storefront/CLAUDE.md` (untracked) | Left alone; the owner decides whether to commit it. |

## Out of scope

The fork decision (Phase 3), product import, Amazon go-live, POS and reports (Phases 4-5), any business behaviour change, deleting existing dev data.

## Work items

### 1. First CI run triage

Input: the owner pastes the failing jobs from the first run of `.github/workflows/ci.yml` (the Phase 1 push). Fix each reported failure at its cause (the likeliest suspects, from Phase 1: the turbo build filter, the four image builds, the first run of `channel-offers-redis-lock.spec.ts`, `next lint`, `medusa lint`). Each fix gets a test or a CI-side assertion where possible. If nothing failed, this item is a no-op.

### 2. Seller-hub tests made deterministic (R7)

- `src/medusa/admin-client.test.ts`: replace the dependency on a running local backend with a local fake HTTP server (a loopback `node:http` server started in `beforeAll`) that serves the endpoints the client calls. Remove the `--exclude`.
- `src/connectors/connections.e2e.test.ts`: all 16 tests hang to the 5000 ms timeout even though the harness is in-process (fake queues, workers and in-memory pool). Find the hang (time-boxed: bisect the first await that never resolves, check for an unresolved promise in the fake pool or a worker started without a connection) and fix it at the cause. Remove the `--exclude`. If it proves to be a real production bug, it gets a separate failing test first.
- `src/queue/queues.test.ts`: replace timing-based waits with event-based waits (resolve on the worker's completed event or poll a condition with a deterministic helper and a generous ceiling). Run the file 20 times in a loop locally without Redis only if it has fakes; otherwise rely on CI with Redis.

### 3. Dashboard (R7)

- Fix the 3 failing combobox tests (`src/components/inputs/combobox/__tests__/combobox.spec.tsx`: typing in controlled mode, typing and local filtering in uncontrolled mode, search cleared on selection). Diagnose first: the failures predate the pricing feature; decide whether the test or the component is wrong, and fix that one.
- Fix the 3 eslint errors in `src/hooks/api/__tests__/orders-carrier-rates.spec.tsx` (two prettier errors via `eslint --fix`, one `max-len` by hand).
- Add a `dashboard` job to `.github/workflows/ci.yml` (Node 22, `yarn install --immutable`, `yarn vitest run` in `packages/admin/dashboard`), plus the offline workflow test assertion.

### 4. Migration verification (R5), gated

Gate G1: starts only when the owner says so. Steps, all against one new empty database `channel_offers_scratch_test` on the local server, credentials taken from the environment of the shell without printing them: create the database, run `medusa db:migrate` limited to the channel-offers module (or the full migrate against that empty database), confirm the two tables exist with the expected columns and indexes (compare with the model definitions), run `medusa db:generate channelOffers` and expect no new migration file (no diff), run `medusa db:rollback channelOffers` once and confirm both tables are gone, then drop the scratch database. A script `apps/backend/src/scripts/verify-channel-offers-migration.ts` is NOT created: the steps are a documented checklist in `docs/ops/migration-check.md`, executed by one agent under the gate. Any mismatch found is fixed by a NEW migration, never by editing the existing one (AGENTS.md).

### 5. Stock split procedure (R5), owner-run

The split script (`apps/backend/src/scripts/split-existing-stock.ts`) is not run by any agent. Deliver `docs/ops/stock-split.md`: when to run it (quiet period, after migration, before receipts and grid edits), the dry run command and how to read its output, the `apply` command (positional word, because `medusa exec` swallows flags), what it does and does not do (no marketplace pushes), how to verify afterwards (the grid shows unallocated 0 for split variants), and what to do if it must be stopped (it is idempotent: variants that already have channel stock are skipped).

### 6. Leftovers

- `docs/ops/secrets.md`: every row that says "Restart" for a value that must be re-read from `.env` says "recreate with `docker compose -f deploy/docker-compose.yml up -d <service>`" (JWT_SECRET, COOKIE_SECRET, EASYPOST_API_KEY, AMAZON_LWA_CLIENT_SECRET, ENCRYPTION_KEY).
- `deploy/ci-workflow.test.mjs`: assert all five NEXT_PUBLIC_* build args on the storefront build line, not just two.
- `apps/seller-hub/vitest.config.ts`: remove the unused `_realDatabaseUrl` binding without changing behaviour (use `delete` on a copy of the env instead).
- `docs/README.md`: index of `docs/phase-0`, `docs/ops`, `docs/superpowers/specs` and `plans`.
- When every exclusion is gone: delete `deploy/ci-known-failures.md` and its references (workflow test, runbook).

## Testing

Each fix keeps or gains a test: the fake server for admin-client, the root-cause test for the connections hang, deterministic waits for queues, the corrected combobox tests, lint clean on the dashboard files, and updated `deploy/*.test.mjs` assertions. Final verification: the full CI workflow green (owner confirms, since GitHub is not readable from here) and local runs of every suite that can run without Docker, with seller-hub run against a `_test` database only if the owner provides one (gate G3, optional).

## Review focus

- No test is "fixed" by weakening its assertions or raising a timeout without finding the cause.
- No dev-database write happens anywhere in this phase.
- The existing migration file is not edited.
- Exclusions and the known-failures document disappear only when the tests they covered pass reliably.

## Delivery

One branch, one plan, in this order: (1) CI triage (depends on the owner's pasted results), (2) seller-hub tests, (3) dashboard fixes and CI job, (4) leftovers and docs, (5) migration check under gate G1, (6) final verification. Items 2-4 are independent of G1 and of CI input, so work can start before either arrives.

## Open assumptions

- The connections.e2e hang has a findable cause in the test harness or the connector manager; if it is a deeper design problem, the plan stops and reports before rewriting the manager.
- The combobox failures come from the test environment or a stale expectation, not from a product regression; the first task proves which.
- The local Postgres server user can create and drop a database (the Phase 1 dev setup suggests it can; unverified).
