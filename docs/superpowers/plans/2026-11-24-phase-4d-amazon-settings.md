# Phase 4d: Amazon and AWS Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner enters the AWS region, SQS queue URL, AWS access key pair and Amazon LWA client id/secret on an admin Settings page; seller-hub stores them encrypted and starts polling the queue without a restart.

**Architecture:** A settings store in seller-hub (one DB row, secrets encrypted, per-field database-over-environment resolution) feeds an `AmazonRuntime` that owns the SQS consumer and SP-API client and rebuilds them on `apply()`. Seller-hub's internal API exposes get/save/clear/test; the backend proxies it under `/admin/amazon-settings`; a new dashboard page `/settings/amazon` edits it.

**Tech Stack:** TypeScript, pg, `@aws-sdk/client-sqs`, vitest (seller-hub, dashboard), jest (backend), Medusa admin, `@medusajs/ui`.

**Spec:** `docs/superpowers/specs/2026-11-24-phase-4d-amazon-settings-design.md`

## Global Constraints

- Secrets (`aws_secret_access_key`, `aws_access_key_id`, `lwa_client_secret`) are encrypted with `crypto/secret-box.ts` and `ENCRYPTION_KEY`; never returned by any API, never logged, never in error text or `console` output. Region, queue URL and LWA client id are plain text.
- Database value wins over environment per field; the AWS key pair is all-or-nothing (both from the database, or both from the environment/default chain). A half pair is rejected on save.
- Blank or absent input on save means keep the stored value (`pick()` rule from `connectors/credentials.ts`). Validation errors name the field, never the value.
- Validation: region `^[a-z]{2}(-[a-z]+)+-\d$`; queue URL `https://` with host ending `amazonaws.com` or `amazonaws.com.cn`; LWA client id starts with `amzn1.application-oa2-client.`.
- Seller-hub tests use only the guarded test database (`TEST_DATABASE_URL` ending `_test`); never the dev database. No live AWS or Amazon calls in any test; SQS is a fake injected through a factory.
- The four env variables (`AWS_REGION`, `SQS_QUEUE_URL`, `AMAZON_LWA_CLIENT_ID`, `AMAZON_LWA_CLIENT_SECRET`) become optional everywhere; seller-hub must boot with all four absent.
- Backend: only GET/POST/DELETE; Zod from `@medusajs/framework/zod`; routes mirror `marketplace-connections`. Dashboard: backend calls only through `sdk.client.fetch`; all new text through `t()` with `en.json` and `$schema.json` updated in step.
- Test commands: seller-hub `cd apps/seller-hub && npx vitest run <path>` (export vars from `apps/seller-hub/.env` except `DATABASE_URL`, set `TEST_DATABASE_URL` for `hub_test`, never print it; `src/queue/queues.test.ts` needs Redis and is a known CI-only failure); backend `cd apps/backend && TEST_TYPE=unit npx jest --runInBand <path>`; dashboard `cd packages/admin/dashboard && npx vitest run <path>`.

## Review Focus

- No response, log line or error from any of the new routes contains a secret value, including after a failed save and a failed test. Assert on the serialized body in Task 3.
- A change saved on the page must replace the running consumer, never add a second one (two pollers would double-handle messages). Test in Task 2.
- Seller-hub boots with none of the four env variables set and none stored, with no consumer started. Test in Tasks 1 and 2.
- Clearing stored settings returns each field to its environment value, or to "not set". Test in Tasks 1 and 3.
- A stored secret that cannot be decrypted (rotated `ENCRYPTION_KEY`) counts as "not set" and does not crash boot or `GET`. Test in Task 1.

---

### Task 1: Settings store and optional env

**Files:**
- Modify: `apps/seller-hub/src/db/schema.ts` (append table), `apps/seller-hub/src/env.ts`
- Create: `apps/seller-hub/src/settings/amazon-settings.ts`
- Test: `apps/seller-hub/src/settings/amazon-settings.test.ts`, extend `apps/seller-hub/src/env.test.ts`, extend `apps/seller-hub/src/db/schema.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SettingSource = "database" | "environment" | "none"
  export type AmazonSettingsInput = {
    awsRegion?: string; sqsQueueUrl?: string; lwaClientId?: string
    awsAccessKeyId?: string; awsSecretAccessKey?: string; lwaClientSecret?: string
  }
  export type ResolvedAmazonSettings = {
    awsRegion: { value: string | null; source: SettingSource }
    sqsQueueUrl: { value: string | null; source: SettingSource }
    lwaClientId: { value: string | null; source: SettingSource }
    awsKeys: { accessKeyId: string; secretAccessKey: string } | null   // null = use default chain
    awsKeysSource: SettingSource
    lwaClientSecret: { value: string | null; source: SettingSource }
  }
  export class AmazonSettingsInputError extends Error { fields: string[]; kind: "invalid" | "missing" }
  export const resolveAmazonSettings: (pool: Pool, encryptionKey: string, env?: NodeJS.ProcessEnv) => Promise<ResolvedAmazonSettings>
  export const saveAmazonSettings: (pool: Pool, encryptionKey: string, input: AmazonSettingsInput) => Promise<void>
  export const clearAmazonSettings: (pool: Pool) => Promise<void>
  ```
  `SellerHubEnv` fields `awsRegion`, `sqsQueueUrl`, `amazonLwaClientId`, `amazonLwaClientSecret` become `string | undefined` and `loadEnv()` no longer throws for them.
- Table `seller_hub.amazon_settings` per the spec (`id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id)`, three plain columns, three `*_encrypted` columns, `updated_at`), `CREATE TABLE IF NOT EXISTS`.

- [ ] **Step 1: Write failing tests** (guarded test DB, cleanup in `afterAll`): `save then resolve returns database source`; `stored secret columns are not the plaintext`; `blank input keeps stored value`; `environment fallback per field with source environment`; `database wins over environment`; `key pair saved together, half pair rejected naming awsAccessKeyId or awsSecretAccessKey`; `invalid region, queue url and client id rejected naming the field not the value`; `clear returns fields to environment or none`; `undecryptable secret resolves as none and does not throw`; `only one row can exist`; env test: `loadEnv succeeds with the four variables absent`; schema test: table exists after `runMigrations`.
- [ ] **Step 2: Run** the new test files. Expected: FAIL.
- [ ] **Step 3: Implement** the table (in `SCHEMA_SQL`), the module (resolve reads the row and `env`, decrypting each secret in its own try/catch so one bad ciphertext only affects that field and logs the field name only; save uses an upsert on `id = true` with merge-by-`pick`), and the `loadEnv` change. Fix every compile error the type change causes in other files with the smallest change (full wiring is Task 2).
- [ ] **Step 4: Run** the three test files and `npx tsc --noEmit`. Expected: PASS, tsc clean.
- [ ] **Step 5: Commit** `feat(seller-hub): Amazon settings store; env vars optional`.

### Task 2: Runtime that applies settings

**Files:**
- Create: `apps/seller-hub/src/settings/amazon-runtime.ts`, `apps/seller-hub/src/settings/sqs-test.ts`
- Modify: `apps/seller-hub/src/sp-api/client.ts` (credential provider), `apps/seller-hub/src/index.ts`
- Test: `apps/seller-hub/src/settings/amazon-runtime.test.ts`, `apps/seller-hub/src/settings/sqs-test.test.ts`, extend `apps/seller-hub/src/sp-api/client.test.ts`

**Interfaces:**
- Consumes: `resolveAmazonSettings`, `ResolvedAmazonSettings`.
- Produces:
  ```ts
  export type SqsFactory = (cfg: { region: string; credentials: { accessKeyId: string; secretAccessKey: string } | null }) => SqsClientLike & { getQueueAttributes(input: { QueueUrl: string }): Promise<unknown> }
  export type AmazonRuntime = { apply(): Promise<void>; consumerRunning(): boolean }
  export const createAmazonRuntime: (deps: { pool: Pool; encryptionKey: string; env?: NodeJS.ProcessEnv; makeSqs: SqsFactory; onOrderChange: (amazonOrderId: string) => Promise<void> }) => AmazonRuntime
  export type SqsTestResult = { ok: true } | { ok: false; code: "not_configured" | "invalid_credentials" | "queue_not_found" | "access_denied" | "unreachable"; message: string }
  export const testSqsConnection: (settings: ResolvedAmazonSettings, makeSqs: SqsFactory, timeoutMs?: number) => Promise<SqsTestResult>
  ```
  `SpApiClientConfig` gains optional `getCredentials?: () => { clientId: string; clientSecret: string }`; when present it overrides the fixed `clientId`/`clientSecret`, read at each token refresh, and the cached access token is dropped when the returned pair differs from the previous one.
- `apply()`: resolve settings; if region and queue URL are both set, stop any running consumer, then create and start a new `SqsConsumer` (credentials passed only when `awsKeys` is non-null); otherwise stop the consumer and log one line. Never throws (logs the error name only). Concurrent `apply()` calls run one at a time.
- `testSqsConnection` maps AWS error names to the five codes and returns messages from a fixed table (never AWS text); default timeout 10 000 ms maps to `unreachable`.
- `index.ts`: replace the inline `SQSClient`/`SqsConsumer` block with `createAmazonRuntime(...)` using a real factory wrapping `SQSClient` (`ReceiveMessageCommand`, `DeleteMessageCommand`, `GetQueueAttributesCommand`), build `SpApiClient` with `getCredentials` reading the current resolved LWA values (empty strings when unset, so SP-API calls fail clearly rather than the process), call `await runtime.apply()` at the place the old consumer started, and pass `runtime` to `createInternalHandler` (Task 3 adds the dep; until then keep a local variable so the file compiles).

- [ ] **Step 1: Write failing tests** with a fake `makeSqs`: `starts a consumer when region and queue url are set`; `does not start when not configured and logs once`; `apply twice replaces the consumer and stops the old one (exactly one running)`; `stopping when settings are cleared`; `credentials passed only when a key pair exists`; `apply swallows errors and never throws`; SQS test: `ok`, `each error name maps to its code`, `timeout maps to unreachable`, `message never contains the AWS error text`; client: `getCredentials value used at refresh`, `changed credentials drop the cached token`.
- [ ] **Step 2: Run** the three specs. Expected: FAIL.
- [ ] **Step 3: Implement** the runtime, the SQS test, the `SpApiClient` provider and the `index.ts` wiring as described above.
- [ ] **Step 4: Run** `npx vitest run src/settings src/sp-api src/sqs` and `npx tsc --noEmit`. Expected: PASS, tsc clean.
- [ ] **Step 5: Commit** `feat(seller-hub): runtime applies Amazon settings without restart`.

### Task 3: Internal API

**Files:**
- Create: `apps/seller-hub/src/internal/amazon-settings-routes.ts`
- Modify: `apps/seller-hub/src/internal/connections.ts` (delegate `/internal/amazon-settings*` paths before the connections routing, reusing `isAuthorized`, `readJsonBody` and `send`; export them from a small shared file if needed), `apps/seller-hub/src/index.ts` (pass the runtime and `makeSqs`)
- Test: `apps/seller-hub/src/internal/amazon-settings-routes.test.ts`

**Interfaces:**
- Consumes: `resolveAmazonSettings`, `saveAmazonSettings`, `clearAmazonSettings`, `AmazonSettingsInputError`, `AmazonRuntime`, `testSqsConnection`, `SqsFactory`.
- Produces (all behind the shared-secret check, 401 otherwise; 405 for the wrong method; 400 for an unknown or non-string body key; 413 over 64 KB):
  - `GET /internal/amazon-settings` → `{ aws_region: {value,source}, sqs_queue_url: {value,source}, lwa_client_id: {value,source}, aws_access_key_id: {set,source}, aws_secret_access_key: {set,source}, lwa_client_secret: {set,source}, consumer_running }`.
  - `POST /internal/amazon-settings` body keys `aws_region, sqs_queue_url, lwa_client_id, aws_access_key_id, aws_secret_access_key, lwa_client_secret` → saves, calls `runtime.apply()`, returns the GET body; `AmazonSettingsInputError` → 422 `{ error: "invalid_input", fields, kind }`.
  - `DELETE /internal/amazon-settings` → clears, `apply()`, returns the GET body.
  - `POST /internal/amazon-settings/test` (same body keys, unsaved values overlay the effective settings, nothing persisted) → `testSqsConnection` result as JSON (200 for both ok and not ok).
- Every non-2xx body is built from fixed strings and field names only.

- [ ] **Step 1: Write failing tests** (fake runtime and fake SQS, real settings store on the guarded DB, `createInternalHandler` style of `connections.test.ts`): `401 without secret`, `405 wrong method`, `GET never contains a secret (serialize the body and assert none of the saved secret strings appear)`, `GET after save shows set flags and sources`, `POST saves and applies`, `POST blank keeps stored`, `POST half key pair is 422 naming the field not the value`, `POST unknown key is 400`, `DELETE clears and applies`, `test overlays unsaved values and persists nothing`, `test failure body has no secret`.
- [ ] **Step 2: Run** the spec. Expected: FAIL.
- [ ] **Step 3: Implement** the routes and the delegation; wire `createInternalHandler` deps with `amazon: { runtime, makeSqs }`.
- [ ] **Step 4: Run** `npx vitest run src/internal src/settings` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(seller-hub): internal Amazon settings API`.

### Task 4: Backend proxy

**Files:**
- Create: `apps/backend/src/api/admin/amazon-settings/route.ts`, `apps/backend/src/api/admin/amazon-settings/test/route.ts`, `apps/backend/src/api/admin/amazon-settings/middlewares.ts`
- Modify: `apps/backend/src/api/middlewares.ts` (register the new middleware array next to `marketplaceConnectionMiddlewares`)
- Test: `apps/backend/src/api/admin/amazon-settings/__tests__/routes.unit.spec.ts`

**Interfaces:**
- Consumes: `respond` and `callSellerHub` from `../marketplace-connections/respond` and `./seller-hub-client`.
- Produces: `GET`, `POST`, `DELETE` `/admin/amazon-settings` and `POST /admin/amazon-settings/test`, each forwarding to the matching seller-hub path (`/internal/amazon-settings`, `/internal/amazon-settings/test`) with the validated body; timeout 15 000 ms for test, default otherwise. `AmazonSettingsSchema` is a `z.strictObject` of the six snake_case keys, each `z.string().trim().max(2048).optional()`; exported with its inferred type.

- [ ] **Step 1: Write failing tests** mirroring the import-preview route tests: path, method, body forwarded exactly, oversized value and unknown key rejected by the schema, seller-hub 422 and 502 passthrough, test route timeout 15 000.
- [ ] **Step 2: Run** `cd apps/backend && TEST_TYPE=unit npx jest --runInBand src/api/admin/amazon-settings`. Expected: FAIL.
- [ ] **Step 3: Implement** routes and middleware registration (`validateAndTransformBody(AmazonSettingsSchema)` on POST of both paths).
- [ ] **Step 4: Run** the same command plus `src/api/admin/marketplace-connections`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): proxy Amazon settings routes`.

### Task 5: Dashboard page

**Files:**
- Create: `packages/admin/dashboard/src/routes/settings-amazon/{amazon-settings.tsx,index.ts}` and `__tests__/amazon-settings.spec.tsx`
- Modify: `packages/admin/dashboard/src/hooks/api/amazon-settings.tsx` (new file, hooks), `packages/admin/dashboard/src/dashboard-app/routes/get-route.map.tsx` (route `settings/amazon`, lazy, breadcrumb `amazonSettings.domain`), `.../components/layout/settings-layout/settings-layout.tsx` (nav entry "Amazon" after sales channels), `packages/admin/dashboard/src/i18n/translations/en.json` and `$schema.json`
- Test: `packages/admin/dashboard/src/hooks/api/__tests__/amazon-settings.spec.tsx`

**Interfaces:**
- Hooks (via `sdk.client.fetch`): `useAmazonSettings()` (GET, query key `amazonSettingsQueryKey`), `useSaveAmazonSettings()` (POST, invalidates the key), `useClearAmazonSettings()` (DELETE, invalidates), `useTestAmazonSettings()` (POST `/test`). Exported type `AmazonSettings` matching seller-hub's GET body.
- Page: six fields; plain values prefilled with a source badge ("Saved here" / "From server environment" / "Not set"); secret fields empty password inputs with placeholder "Leave blank to keep" and a "Set" badge when `set`; "Test connection" sends only non-blank form values and shows the result code message (success or failure alert; text states that LWA is not checked here); "Save" disabled until a field changed, sends only changed non-blank fields; "Clear stored settings" behind a confirm prompt; status line from `consumer_running`; load error or 502 shows a banner with the message and no values; validation errors from a 422 show next to the named field.

- [ ] **Step 1: Write failing specs** (mock hooks like `channel-import-panel.spec.tsx`): `renders sources and Set badges and never a secret value`, `save sends only changed fields`, `save disabled until changed`, `test shows success and each failure message`, `clear asks for confirmation`, `load error banner shows no stale values`, `422 shows field error`, `status line running and not running`; hooks spec: query key, methods and paths, invalidation after save and clear.
- [ ] **Step 2: Run** `cd packages/admin/dashboard && npx vitest run src/routes/settings-amazon src/hooks/api/__tests__/amazon-settings.spec.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** hooks, page, route, nav entry and i18n strings (all text through `t()`).
- [ ] **Step 4: Run** the specs plus `npx eslint` on changed files and the existing settings-layout spec if present. Expected: PASS, 0 lint errors.
- [ ] **Step 5: Commit** `feat(dashboard): Amazon settings page`.

### Task 6: Deploy config, docs, verification

**Files:**
- Modify: `deploy/docker-compose.yml`, `deploy/required-env.json`, `deploy/check-env.test.mjs`, `deploy/compose.test.mjs` (only if it asserts the old variables), `deploy/.env.example`, `docs/ops/runbook.md`, `docs/ops/secrets.md`, `apps/seller-hub/README.md`

- [ ] **Step 1: Update deploy config:** the four variables become `${VAR:-}` in compose and are removed from the required list in `required-env.json`; `.env.example` comments say "optional; normally entered on Settings, Amazon"; fix the tests that assert the old requirement so they now assert optional.
- [ ] **Step 2: Docs:** runbook section "Amazon settings" (what to enter, the Test connection button and what it does and does not check, the status line, clearing, rollback by clearing returns to env; IAM least privilege `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes` on the one queue; the queue's `ORDER_CHANGE` subscription remains an AWS-side owner step); replace the stale "Until Amazon goes live, CredentialsProviderError" notes in runbook (items 7 and the AWS credentials line) and the stale placeholder notes in `apps/seller-hub/README.md`; update the env rows in `docs/ops/secrets.md` (now: stored encrypted in seller-hub, rotate on the page; env remains a fallback).
- [ ] **Step 3: Full verification and honest report:** seller-hub `npx vitest run --exclude src/queue/queues.test.ts` and `npx tsc --noEmit`; backend `TEST_TYPE=unit npx jest --runInBand` and `npx tsc --noEmit -p apps/backend` (list pre-existing unrelated errors); dashboard sales-channel, settings and hooks specs; `node --test deploy/*.test.mjs`. State plainly that nothing was run against real AWS or Amazon.
- [ ] **Step 4: Commit** `feat(deploy): Amazon env vars optional; docs: Amazon settings`.
