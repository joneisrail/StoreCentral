# Phase 4b: Sync-Status Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the owner, on the sales-channel page, whether a Shopify or WooCommerce connection's sync is running and healthy, with counts, last successes and recent failures.

**Architecture:** A read-only SQL function in seller-hub builds the status object. A new internal route serves it, the backend proxies it, and a dashboard panel polls it every 30 seconds.

**Tech Stack:** TypeScript, pg, vitest (seller-hub, dashboard), jest (backend), Medusa admin SDK, `@medusajs/ui`.

**Spec:** `docs/superpowers/specs/2026-11-23-phase-4b-sync-status-screen-design.md`

## Global Constraints

- Read-only: no writes, no migration, no new tables or indexes.
- Every query filters by `integration_account_id`; another account's rows never appear.
- `last_error` text leaves seller-hub only after `sanitizeSyncError` and truncation to 300 characters. No credential column is ever selected.
- `recent_failures`: newest first by `updated_at`, at most 25; `failures_total` is the full count of `sync_job` rows with `status='failed'`.
- `never_pushed` = listings with `last_synced_quantity IS NULL`.
- Seller-hub tests use only the guarded test database (`TEST_DATABASE_URL` ending `_test`). Never touch the dev database.
- Backend: only GET/POST/DELETE; routes mirror `[id]/import-preview/route.ts`; timeout 15 000 ms.
- Dashboard: backend calls only through `sdk.client.fetch`; new text in `en.json` and `$schema.json` in step; panel for Shopify and WooCommerce only (never Amazon), also shown for read-only connections.

## Review Focus

- Another account's jobs and listings must never be counted or listed. Test in Task 1.
- An account with no listings and no jobs returns zeros and nulls, not errors. Test in Task 1.
- A failure message containing a token-like value must come out redacted and at most 300 characters. Test in Task 1.
- Seller-hub down or the backend returning an error must show a banner with the message and no stale numbers. Test in Task 4.
- `sync_live` false (stopped connection) must show a "sync is not running" notice while still showing the stored counts. Test in Tasks 2 and 4.

---

### Task 1: Status query

**Files:**
- Create: `apps/seller-hub/src/sync/sync-status.ts`
- Test: `apps/seller-hub/src/sync/sync-status.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SyncKind = "product" | "inventory" | "price" | "order" | "tracking"
  export type SyncStatusData = {
    connection: { status: string; last_error: string | null; last_synced_at: string | null }
    listings: { total: number; by_status: Record<string, number>; with_error: number; never_pushed: number }
    jobs: {
      by_type: Record<string, { pending: number; processing: number; failed: number; succeeded: number }>
      last_succeeded_at: Record<SyncKind, string | null>
    }
    recent_failures: { sync_type: string; external_id: string; attempts: number; last_error: string | null; updated_at: string }[]
    failures_total: number
  }
  export const SYNC_FAILURE_LIMIT = 25
  export const getSyncStatus: (pool: Pool, integrationAccountId: string) => Promise<SyncStatusData | null>  // null when the account does not exist
  ```
- `by_type` always contains all five kinds with zero counts when absent; `by_status` contains only statuses present. Timestamps are ISO strings. `last_error` goes through `sanitizeSyncError` (from `../medusa/admin-client.js`) and is cut to 300 characters, for the connection, the failures list, and nothing else is selected.

- [ ] **Step 1: Write failing tests** (guarded test DB, follow `sync/channel-import-run.test.ts` for pool and schema setup, clean up own rows in `afterAll`): `unknown account returns null`, `empty account returns zeros and nulls`, `counts listings by status with errors and never pushed`, `counts jobs by type and status and last success time`, `recent failures newest first capped at 25 with total`, `other accounts rows are excluded`, `error text redacted and truncated to 300`.
- [ ] **Step 2: Run** `cd apps/seller-hub && npx vitest run src/sync/sync-status.test.ts` with `TEST_DATABASE_URL` derived (without printing) from `apps/seller-hub/.env`'s `DATABASE_URL` by swapping the database name for `hub_test`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `getSyncStatus` with one query per block (account row, listing aggregates, job aggregates, last successes, failures page plus count).
- [ ] **Step 4: Run the test file and `npx tsc --noEmit`.** Expected: PASS, tsc clean.
- [ ] **Step 5: Commit** `feat(seller-hub): sync status query`.

### Task 2: Internal route

**Files:**
- Modify: `apps/seller-hub/src/internal/connections.ts`
- Test: extend `apps/seller-hub/src/internal/connections.test.ts`

**Interfaces:**
- Consumes: `getSyncStatus`, `SyncStatusData`.
- Produces: `GET /internal/connections/:id/sync-status` returning `{ sync_live: boolean } & SyncStatusData`. 401 without the secret; 405 for other methods; 404 for an invalid or unknown id. `sync_live` is `marketplace !== "amazon" && manager.get(id) !== null` (same expression as the connection view). Works without a live runtime.

- [ ] **Step 1: Write failing tests** in the existing fake-pool style: `401 without secret`, `404 unknown id`, `405 on POST`, `returns status with sync_live true when a runtime is live`, `sync_live false when not running but data still returned`, `sync_live false for amazon`.
- [ ] **Step 2: Run** `npx vitest run src/internal/connections.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**: add `"sync-status"` to the action whitelist with expected method `GET`, and a handler that checks the row (`findRow`), calls `getSyncStatus`, and merges `sync_live`.
- [ ] **Step 4: Run** `npx vitest run src/internal src/sync/sync-status.test.ts` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(seller-hub): internal sync-status route`.

### Task 3: Backend proxy

**Files:**
- Create: `apps/backend/src/api/admin/marketplace-connections/[id]/sync-status/route.ts`
- Test: extend `apps/backend/src/api/admin/marketplace-connections/__tests__/routes.unit.spec.ts`

**Interfaces:**
- Produces: `GET /admin/marketplace-connections/:id/sync-status` → `callSellerHub("GET", connectionPath(req.params.id, "sync-status"), undefined, { timeoutMs: 15_000 })` through `respond`. No middleware entry needed (no body).

- [ ] **Step 1: Write failing tests** mirroring the import-preview route tests: path and method, timeout 15 000, id encoding, seller-hub 404 and 502 passthrough.
- [ ] **Step 2: Run** `cd apps/backend && TEST_TYPE=unit npx jest --runInBand src/api/admin/marketplace-connections`. Expected: FAIL.
- [ ] **Step 3: Implement** the route file.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): proxy sync-status route`.

### Task 4: Dashboard panel, docs, verification

**Files:**
- Modify: `packages/admin/dashboard/src/hooks/api/marketplace-connections.tsx`, `.../sales-channel-marketplace-section/sales-channel-marketplace-section.tsx`, `packages/admin/dashboard/src/i18n/translations/en.json`, `$schema.json` (same folder), `docs/ops/runbook.md` (short "Reading the sync-status panel" section)
- Create: `packages/admin/dashboard/src/routes/sales-channels/sales-channel-detail/components/channel-sync-status-panel/{channel-sync-status-panel.tsx,index.ts}` and its `__tests__/channel-sync-status-panel.spec.tsx`; extend the hooks spec.

**Interfaces:**
- Hook: `useSyncStatus(connectionId: string, options?: { enabled?: boolean })` → `useQuery` on `GET /admin/marketplace-connections/:id/sync-status` via `sdk.client.fetch`, `refetchInterval: 30_000`, `refetchIntervalInBackground: false`; exported `syncStatusQueryKey(connectionId)`; exported type `SyncStatus` matching the seller-hub shape (`{ sync_live } & SyncStatusData`).
- `ChannelSyncStatusPanel({ connectionId, marketplace })`: returns null for `amazon`. Renders: error `Alert` with the returned message and a Retry button and NO numbers when the query errors; a "sync is not running" notice when `sync_live` is false; listing counts (total, by status, with error, never pushed); a five-row table of job kinds with pending/processing/failed and last success time ("never" when null); a failures table (kind, id, attempts, message, time) with "Showing N of M" when `failures_total` exceeds the rows; a Refresh button calling `refetch`. Mounted in `ConnectionDetails` for every non-Amazon connection including read-only ones.

- [ ] **Step 1: Write failing specs** (mock hooks as in `channel-import-panel.spec.tsx`): `shows counts jobs and failures`, `error banner with retry and no numbers`, `not running notice with stored counts`, `shows Showing N of M`, `refresh refetches`, `hidden for amazon`, `shown for read-only connection` (section spec), hook spec: query key and 30 s interval.
- [ ] **Step 2: Run** `cd packages/admin/dashboard && npx vitest run src/routes/sales-channels/sales-channel-detail src/hooks/api/__tests__/marketplace-connections.spec.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** hook, panel, mount, i18n strings (all text through `t()`), runbook section (what each number means, where failures come from: `seller_hub.sync_job`, that the panel reads only).
- [ ] **Step 4: Run the specs above plus `npx eslint` on changed files.** Expected: PASS, 0 lint errors.
- [ ] **Step 5: Full verification** and report honestly: seller-hub `npx vitest run` (export the vars from `apps/seller-hub/.env` except `DATABASE_URL`, and set `TEST_DATABASE_URL`; `src/queue/queues.test.ts` needs Redis and is a known CI-only failure), seller-hub `npx tsc --noEmit`, backend marketplace-connections specs, dashboard sales-channels specs, `node --test deploy/ci-workflow.test.mjs` if present.
- [ ] **Step 6: Commit** `feat(dashboard): sync-status panel; docs: runbook section`.
