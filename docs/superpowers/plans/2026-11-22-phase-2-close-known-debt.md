# Phase 2: Close Known Debt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Leave the repository with no excluded or "known flaky" tests, a verified `channel-offers` migration, a dashboard CI job, and the Phase 1 leftovers cleared.

**Architecture:** Test and docs work only; no business behaviour changes. Hermetic fakes replace tests that read a live backend; the hanging connections e2e is fixed at its cause; the migration is verified in a throwaway database under an owner gate.

**Tech Stack:** Vitest (seller-hub, dashboard), Jest (backend), Node test runner (`deploy/*.test.mjs`), GitHub Actions, PostgreSQL scratch database (gated).

**Spec:** `docs/superpowers/specs/2026-11-22-phase-2-close-known-debt-design.md`

## Global Constraints

- Never write to, migrate, or delete from the developer's dev database. The only database an agent may create is `channel_offers_scratch_test`, and only in Task 9 after the owner's explicit go-ahead (gate G1); credentials come from the shell environment without being printed.
- Never read, print or commit values from any `.env`. Never edit an existing migration file; fix a mismatch with a NEW migration.
- A test is never "fixed" by weakening an assertion, skipping it, or raising a timeout without first finding the cause (state the cause in the commit message).
- No change under `packages/` except `packages/admin/dashboard` (Tasks 2 and 3). No new dependency; no `yarn.lock` edit.
- Worktree rule: run in a git worktree under `.worktrees/phase-2`; its `node_modules` are junctions to the main checkout, so never run `yarn install`, and before removing the worktree unlink those junctions (never recursive-delete through them).
- Style: no semicolons, double quotes, 2-space indent, kebab-case files, no emojis; Markdown tables for docs.
- No push, no merge, no marketplace or real AWS/Stripe calls.

## Review Focus

- A fixed test must still fail when the behaviour it guards breaks (show a mutation or removed-guard check for each rewritten test).
- No dev-database write anywhere; the scratch database is dropped even when a step fails.
- `deploy/ci-known-failures.md` is deleted only when every exclusion in `ci.yml` has been removed and its test passes.
- The existing migration file is byte-identical at the end.
- CI workflow test (`deploy/ci-workflow.test.mjs`) stays in sync with every `ci.yml` change.

---

### Task 1: Dashboard lint errors

**Files:**
- Modify: `packages/admin/dashboard/src/hooks/api/__tests__/orders-carrier-rates.spec.tsx`

- [ ] **Step 1:** Run `cd packages/admin/dashboard && npx eslint src/hooks/api/__tests__/orders-carrier-rates.spec.tsx`. Expected: 3 errors (line 18 `max-len` and prettier, line 106 prettier).
- [ ] **Step 2:** Apply `npx eslint --fix` for the two prettier errors; fix the `max-len` at line 18 by hand (split the `vi.mock` object so no line exceeds 80 characters) without changing behaviour.
- [ ] **Step 3:** Re-run eslint (expect 0 errors) and `npx vitest run src/hooks/api/__tests__/orders-carrier-rates.spec.tsx` (expect the same pass count as before the change).
- [ ] **Step 4: Commit** `fix(dashboard): lint errors in orders-carrier-rates spec`.

### Task 2: Combobox test failures

**Files:**
- Modify: `packages/admin/dashboard/src/components/inputs/combobox/__tests__/combobox.spec.tsx` and/or `combobox.tsx` (whichever is wrong)

- [ ] **Step 1: Diagnose, do not guess.** Run `npx vitest run combobox` in `packages/admin/dashboard`; the failing tests are "should allow typing in search input in controlled mode", "should allow typing and local option filtering in uncontrolled mode" and "should clear search value upon value selection". For each, record the exact assertion that fails and why (read the component and the test; check `git log -S` on the component to see whether the behaviour or the test changed last).
- [ ] **Step 2:** Decide per failure: product bug (fix `combobox.tsx` with the failing test as the guard) or stale/incorrect test (fix the test to assert the real intended behaviour, not a weaker one). Write the decision and evidence in the commit message.
- [ ] **Step 3:** Run `npx vitest run combobox` (expect 4/4) and `npx vitest run` for the specs that import the combobox (grep for `inputs/combobox`) to prove no regression.
- [ ] **Step 4: Commit** `fix(dashboard): combobox search behaviour and its tests` (adjust subject to what was actually fixed).

### Task 3: Hermetic admin-client test

**Files:**
- Create: `apps/seller-hub/src/test-support/fake-medusa.ts`
- Create: `apps/seller-hub/src/test-support/fake-medusa.test.ts`
- Modify: `apps/seller-hub/src/medusa/admin-client.test.ts`

**Interfaces:**
- Produces: `startFakeMedusa(handlers?: Partial<FakeMedusaState>): Promise<{ baseUrl: string; close: () => Promise<void>; state: FakeMedusaState; requests: { method: string; path: string }[] }>` where `FakeMedusaState` holds the sales channels, variants (id, sku, price, inventory quantity), draft orders and orders the fake serves. It listens on `127.0.0.1` port 0 (random) and implements exactly the Medusa admin routes `MedusaAdminClient` calls: `POST /auth/user/emailpass`, sales-channel listing, draft-order create/convert, order lookup by metadata, variant pricing and inventory reads, `listVariantsBySku`, and the channel push-values and sync-result routes (read `apps/seller-hub/src/medusa/admin-client.ts` for the real paths, query strings and response shapes; the fake must return the shapes the client parses).

- [ ] **Step 1: Failing tests** for the fake itself in `fake-medusa.test.ts`: login returns a token, an unknown route returns 404, `close()` frees the port.
- [ ] **Step 2:** Run `cd apps/seller-hub && yarn vitest run src/test-support/fake-medusa.test.ts`; expect FAIL; implement `startFakeMedusa`; expect PASS.
- [ ] **Step 3:** Rewrite `admin-client.test.ts` so `beforeAll` starts the fake (seeded with an "Amazon" sales channel, two products/variants with prices and stock, the metadata orders the existing tests expect) and points `MedusaAdminClient` at `baseUrl`; keep every existing test case and its assertions (same names), removing only the dependence on `process.env.MEDUSA_*` and a real backend. Tests that asserted real-data discovery now assert against the seeded fake data.
- [ ] **Step 4: Mutation check:** temporarily break one client behaviour (for example the `-created_at` sort parameter in `findOrderByMetadata`) and confirm the corresponding test fails; revert the break. Report it.
- [ ] **Step 5:** Remove `--exclude src/medusa/admin-client.test.ts` from the seller-hub job in `.github/workflows/ci.yml`, update `deploy/ci-workflow.test.mjs` and remove its row from `deploy/ci-known-failures.md`. Run `node --test deploy/*.test.mjs` and `yarn vitest run src/medusa src/test-support`; both must pass with no backend running.
- [ ] **Step 6: Commit** `test(seller-hub): admin-client tests run against a local fake backend`.

### Task 4: Deterministic queue test

**Files:**
- Create: `apps/seller-hub/src/test-support/wait-for.ts`, `wait-for.test.ts`
- Modify: `apps/seller-hub/src/queue/queues.test.ts`

**Interfaces:**
- Produces: `waitFor(condition: () => boolean | Promise<boolean>, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<void>` (defaults 5000 and 10; rejects with an Error naming "waitFor timed out" instead of hanging).

- [ ] **Step 1: Failing tests** for `waitFor`: resolves once the condition turns true, rejects after `timeoutMs`, awaits async conditions.
- [ ] **Step 2:** Implement; expect PASS.
- [ ] **Step 3:** In `queues.test.ts` find every fixed `sleep`/`setTimeout` wait or elapsed-time assertion (read the file: 159 lines) and replace it with `waitFor` on the observable condition (worker completed/failed event, attempt count, job state). Record in the report each wait you replaced and what it now waits for. If the file needs a real Redis (it is DB-and-Redis dependent), state which tests need it and run only what can run here; the Redis-backed part is verified in CI.
- [ ] **Step 4:** Run the file locally where possible, 10 consecutive times for any part that runs without Redis, and `yarn vitest run src/test-support`.
- [ ] **Step 5:** Update `deploy/ci-known-failures.md` (remove the `queues.test.ts` row only if a deterministic design was achieved; otherwise keep it and say why).
- [ ] **Step 6: Commit** `test(seller-hub): deterministic waits in queue tests`.

### Task 5: Find and fix the connections e2e hang

**Files:**
- Modify: `apps/seller-hub/src/connectors/connections.e2e.test.ts` and/or the code it exercises (`manager.ts`, `internal/connections.ts`, `shopify/bootstrap.ts`, `woocommerce/bootstrap.ts`) depending on the cause
- Test: the same e2e file plus a new focused regression test where the cause is in product code

- [ ] **Step 1: Reproduce and bisect (time-box: 2 hours of agent effort).** Run `cd apps/seller-hub && yarn vitest run src/connectors/connections.e2e.test.ts` with no DATABASE_URL (expect all 16 to time out at 5000 ms). Bisect: run a single test with `-t`, add temporary `console.log` markers (remove them before committing) to find the first `await` that never resolves (the in-process server `listen`, `createConnectorManager`, `startShopify`/`startWooCommerce` with fake queues, the internal handler request, the `accountPool` query path). Check specifically for: a server never started or never closed between tests, a fake queue/worker whose `add`/`close` returns a never-resolving promise, a fetch fake that does not answer a call the code makes, and an `afterEach` that awaits something that never settles.
- [ ] **Step 2: Write down the cause** (one paragraph in the report: file, line, why it hangs, and why it also hangs at merge base `f8c071f68d`).
- [ ] **Step 3:** Fix at the cause. If the cause is in product code (a real bug in the manager or handlers), first write a failing focused test for it, then fix it; if the design problem is larger than a local fix, STOP and report BLOCKED with the evidence instead of rewriting the connector manager.
- [ ] **Step 4:** `yarn vitest run src/connectors/connections.e2e.test.ts` passes 16/16, run three times in a row; then `yarn vitest run src/connectors src/webhook src/internal` to prove no neighbour regressed.
- [ ] **Step 5:** Remove `--exclude src/connectors/connections.e2e.test.ts` from `ci.yml`, update `deploy/ci-workflow.test.mjs` and delete its row in `deploy/ci-known-failures.md`.
- [ ] **Step 6: Commit** `fix(seller-hub): connections e2e no longer hangs (<cause in a few words>)`.

### Task 6: Dashboard job in CI and stronger workflow assertions

**Files:**
- Modify: `.github/workflows/ci.yml`, `deploy/ci-workflow.test.mjs`

- [ ] **Step 1: Failing test first** in `deploy/ci-workflow.test.mjs`: the workflow has a `dashboard` job that runs `yarn vitest run` with `working-directory: packages/admin/dashboard` after `yarn install --immutable`; the storefront build line carries all five `NEXT_PUBLIC_*` build args (`NEXT_PUBLIC_MEDUSA_BACKEND_URL`, `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`, `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_DEFAULT_REGION`, `NEXT_PUBLIC_STRIPE_KEY`). Run `node --test deploy/ci-workflow.test.mjs`; expect FAIL on the dashboard job.
- [ ] **Step 2:** Add the `dashboard` job (same Node 22, corepack, yarn cache, `yarn install --immutable` as the other jobs; `permissions` unchanged). Run the full dashboard suite once locally (`cd packages/admin/dashboard && npx vitest run`) and report the count; it must be green after Tasks 1 and 2 (if other failures appear, report them, do not exclude).
- [ ] **Step 3:** `node --test deploy/*.test.mjs` passes.
- [ ] **Step 4: Commit** `ci: run the dashboard unit tests and assert all storefront build args`.

### Task 7: Small leftovers and docs

**Files:**
- Modify: `apps/seller-hub/vitest.config.ts`, `docs/ops/secrets.md`
- Create: `docs/README.md`, `docs/ops/stock-split.md`, `docs/ops/migration-check.md`

- [ ] **Step 1:** `vitest.config.ts`: stop destructuring the unused `_realDatabaseUrl`; build the env copy with a spread and `delete copy.DATABASE_URL` instead. Behaviour must be identical: add or keep a test in `src/test-support` proving a `DATABASE_URL` in the loaded env never reaches tests (run `yarn vitest run src/test-support`).
- [ ] **Step 2:** `secrets.md`: rows for `JWT_SECRET`, `COOKIE_SECRET`, `EASYPOST_API_KEY`, `AMAZON_LWA_CLIENT_SECRET` and `ENCRYPTION_KEY` say "Recreate the service with `docker compose -f deploy/docker-compose.yml up -d <service>`" instead of "Restart".
- [ ] **Step 3:** `docs/README.md`: an index linking `docs/phase-0`, `docs/ops` (runbook, secrets, memory, stock-split, migration-check) and the specs/plans folders with one line each.
- [ ] **Step 4:** `docs/ops/stock-split.md` as the spec's section 5 describes (when to run, dry run command `npx medusa exec ./src/scripts/split-existing-stock.ts`, apply command with the positional word `apply`, what it does and does not do, verification in the grid, idempotence). Read `apps/backend/src/scripts/split-existing-stock.ts` first so every statement is true; do not run it.
- [ ] **Step 5:** `docs/ops/migration-check.md`: the exact checklist Task 9 executes (below), with the commands and expected results.
- [ ] **Step 6: Commit** `docs: index, stock split procedure, migration check checklist, vitest config tidy`.

### Task 8: Triage the first CI run (needs owner input)

**Files:** depends on the failures reported.

- [ ] **Step 1:** The controller asks the owner to paste the failing jobs and log excerpts from the first CI run of the Phase 1 push (GitHub is not readable from here). Do not start this task without that input; if the owner reports a green run, mark the task complete with no changes.
- [ ] **Step 2:** For each failure: reproduce locally where possible, find the cause, fix it with a test or a CI-side assertion, and record cause and fix in the commit message. Failures that cannot be reproduced without Docker or GitHub are fixed from the log evidence and listed as "verified only by the next CI run".
- [ ] **Step 3:** Update `deploy/ci-known-failures.md` and `deploy/ci-workflow.test.mjs` if a job's definition changes.
- [ ] **Step 4: Commit** one commit per distinct cause, subject `fix(ci): <cause>`.

### Task 9: Verify the channel-offers migration in a scratch database (gate G1)

**Files:**
- Modify: `docs/ops/migration-check.md` (record the actual results)
- Create (only if a mismatch is found): a NEW migration under `apps/backend/src/modules/channel-offers/migrations/`

**Interfaces:**
- Consumes: `docs/ops/migration-check.md` checklist from Task 7. The existing `Migration20261117120000.ts` must remain byte-identical (verify with `git diff --stat` and a checksum before and after).

- [ ] **Step 1: Gate.** Do not start without the owner's explicit "go" for G1 in this conversation. Then take the PostgreSQL connection settings from the shell environment of the main checkout's `apps/backend` (source `.env` inside the command, never echo it).
- [ ] **Step 2:** Create the database `channel_offers_scratch_test` (refuse to proceed if a database of that name already exists; never use any other name). Point `DATABASE_URL` for the following commands at it only.
- [ ] **Step 3:** From `apps/backend` run the migration for a fresh database (`npx medusa db:migrate`; if the full migrate needs the whole Medusa schema, that is expected and is created in the scratch database). Confirm with read-only SQL that `channel_offer` and `channel_stock_movement` exist with the columns, types, nullability, defaults and the unique indexes the models define (compare against `apps/backend/src/modules/channel-offers/models/*.ts`).
- [ ] **Step 4:** Run `npx medusa db:generate channelOffers`. Expected: no new migration file is produced. If one is produced, inspect and decide: if the hand-written migration is wrong or incomplete, commit the generated file as a NEW migration (do not edit the old one) after reviewing it; if the diff is only formatting or a snapshot difference, record it in the results and discard the generated files (`git checkout`/delete the new files).
- [ ] **Step 5:** Run `npx medusa db:rollback channelOffers` once; confirm both tables are gone.
- [ ] **Step 6: Always** drop `channel_offers_scratch_test` (also when any earlier step fails; use a `finally`-style cleanup) and confirm with a read-only listing that it no longer exists. Confirm the dev database was never touched (no connection to it was made; state how).
- [ ] **Step 7:** Record commands, outputs (names only, no credentials) and conclusions in `docs/ops/migration-check.md`. **Commit** `docs(ops): channel-offers migration verified in a scratch database` (plus any new-migration commit, subject `fix(channel-offers): migration <what>`).

### Task 10: Retire the known-failures document and verify the phase

**Files:**
- Delete: `deploy/ci-known-failures.md` (only if empty of real exclusions)
- Modify: `deploy/ci-workflow.test.mjs`, `docs/ops/runbook.md` (remove references)

- [ ] **Step 1:** Confirm `ci.yml` contains no `--exclude`, no `continue-on-error` and no skipped job; if an exclusion remains for a reason documented as unfixable here (for example the Redis lock spec until it has a green CI history), keep ONLY that row in the document, rename the document accordingly, and say so in the report instead of deleting it.
- [ ] **Step 2:** Remove the document and every reference to it (grep the repo), update tests; run `node --test deploy/*.test.mjs`.
- [ ] **Step 3:** Verification: seller-hub `yarn build` and `yarn vitest run` (with no `TEST_DATABASE_URL`, classify the failures: only the nine DB-backed files may fail, each failing loudly by design); dashboard `npx vitest run` (all green) and `npx eslint` on the changed dashboard files; backend `yarn test:unit -- src/config`; confirm `git diff master --stat` touches nothing in `packages/` except `packages/admin/dashboard`, no `.env` file, and the migration file byte-identical.
- [ ] **Step 4:** List what only the next CI run can confirm (the dashboard job, the Redis lock spec history, anything from Task 8 that could not be reproduced).
