# Seller Hub — Amazon Sync Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/seller-hub`, a standalone service that syncs products, inventory, prices, and orders between the existing Medusa backend and Amazon (SP-API), proving the sync-engine pattern end-to-end against one marketplace.

**Architecture:** A new Node/TypeScript workspace, fully separate from Medusa, with its own Postgres schema (`seller_hub`) in the same database instance and its own BullMQ queues on the existing Redis. It talks to Medusa only through its existing Admin API (login + draft-orders), and to Amazon only through SP-API (LWA auth, rate-limited REST calls) and an owned SQS queue for notifications. One new file is added to Medusa itself: a subscriber that forwards inventory/price change events to Seller Hub's webhook receiver.

**Tech Stack:** Node 22+, TypeScript, `pg` (raw SQL, no ORM), BullMQ + ioredis, native `fetch` for HTTP, `@aws-sdk/client-sqs`, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-15-seller-hub-amazon-sync-design.md`

## Global Constraints

- No changes to `packages/` in the StoreCentral repo (Medusa core source) — everything lives in `test-project`.
- Exactly one new file in `apps/backend`: a subscriber under `apps/backend/src/subscribers/`. No other Medusa backend changes.
- Seller Hub's tables live in their own Postgres schema (`seller_hub`), schema-qualified in every query — never create tables in Medusa's default schema.
- Idempotency key for every sync attempt: `(integration_account_id, sync_type, external_id)` — enforced as a DB unique constraint, not just application logic (per spec's Error Handling section).
- Retry policy: transient errors (`429`, `5xx`) retry with exponential backoff + jitter, capped attempts; permanent errors (`4xx` validation) fail immediately into a `failed` state, no retry (per spec's Error Handling section).
- Source of truth per field: Medusa owns inventory/price (push-only to Amazon); Amazon owns its own order status (pull-only into Medusa) (per spec's Data Flow section).
- No live Amazon or AWS calls in automated tests — SP-API and SQS clients are always constructor-injected so tests use fakes/mocks. Real connectivity is proven only in the manual smoke checklist (Task 13), gated on the user's AWS account and Amazon SP-API app approval (external prerequisites noted in the spec's Open Items).
- Credentials (LWA refresh token) are encrypted at rest (per spec's Security goals) — never stored or logged in plaintext.

## Review Focus

- **Duplicate SQS delivery of the same Amazon order** — SQS's at-least-once delivery means the same `ORDER_CHANGE` notification can arrive twice; the system must not create two Medusa orders for one Amazon order. Covered by Task 6's double-import test.
- **A sync job that fails validation (permanent 4xx) vs. one that fails transiently (429/5xx)** — these must behave differently (no retry vs. retry-with-backoff); a naive implementation that retries everything the same way would hammer Amazon after a permanent rejection. Covered by Task 7's two-outcome test.
- **An Amazon order referencing a SKU with no matching `channel_listing` row** — the mapping step in order import has no fallback defined anywhere in the spec; silently dropping or crashing are both bad. Covered by Task 6's unmapped-SKU test (fails the job into `needs attention`, does not create a partial order).
- **The webhook receiver or SQS consumer receiving a malformed/unexpected payload** — both are entry points fed by external systems (Medusa's own subscriber, and Amazon's SQS); a malformed payload must not crash the process. Covered by Task 9 and Task 10's malformed-payload tests.
- **A purely transient failure that never stops failing** — must exhaust its attempt cap and land the BullMQ job in its `failed` state rather than retrying forever; the function that owns the Medusa/Amazon side effect must then call `markSyncJobFailed` exactly once, not leave `sync_job` stuck at `processing`. Covered by Task 7's exhausted-attempts test (queue mechanics) and Task 8's `pushPriceUpdate` permanent-rejection test (the `sync_job` correlation, at the layer that owns it).

---

## Task 1: Scaffold the `apps/seller-hub` workspace

**Files:**
- Create: `apps/seller-hub/package.json`
- Create: `apps/seller-hub/tsconfig.json`
- Create: `apps/seller-hub/.env.example`
- Create: `apps/seller-hub/src/env.ts`
- Create: `apps/seller-hub/src/index.ts`
- Create: `apps/seller-hub/vitest.config.ts`
- Test: `apps/seller-hub/src/env.test.ts`

**Interfaces:**
- Produces: `loadEnv(): SellerHubEnv` in `src/env.ts`, where
  ```ts
  type SellerHubEnv = {
    databaseUrl: string
    redisUrl: string
    medusaBackendUrl: string
    medusaAdminEmail: string
    medusaAdminPassword: string
    encryptionKey: string // 32-byte hex string, used by Task 2's crypto helper
    awsRegion: string
    sqsQueueUrl: string
    amazonLwaClientId: string
    amazonLwaClientSecret: string
  }
  ```
  Throws if a required variable is missing. Every later task's modules read config through this function, never `process.env` directly.

- [ ] **Step 1: Write the failing test for `loadEnv`**

```ts
// src/env.test.ts
test("loadEnv throws when a required variable is missing", () => {
  const prevEnv = { ...process.env }
  delete process.env.DATABASE_URL
  expect(() => loadEnv()).toThrow(/DATABASE_URL/)
  process.env = prevEnv
})

test("loadEnv returns all fields when env is fully set", () => {
  // set all required vars to dummy values, call loadEnv(), assert each
  // field on the returned object matches what was set
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @dtc/seller-hub test env.test.ts`
Expected: FAIL — `loadEnv` is not defined / module does not exist yet.

- [ ] **Step 3: Create the workspace scaffold**

`package.json`: name `@dtc/seller-hub`, `"scripts"`: `"dev": "tsx watch src/index.ts"`, `"build": "tsc"`, `"start": "node dist/index.js"`, `"test": "vitest run"`. Dependencies: `pg`, `bullmq`, `ioredis`, `@aws-sdk/client-sqs`. Dev dependencies: `typescript`, `tsx`, `vitest`, `@types/node`, `@types/pg`.

`tsconfig.json`: target ES2022, module NodeNext, strict true, outDir `dist`, rootDir `src` — match the strictness level already used by `apps/backend`'s own `tsconfig.json` (read it for the exact compiler options to mirror).

`.env.example`: one line per `SellerHubEnv` field, uppercase snake_case (e.g. `DATABASE_URL`, `REDIS_URL`, `MEDUSA_BACKEND_URL`, `MEDUSA_ADMIN_EMAIL`, `MEDUSA_ADMIN_PASSWORD`, `ENCRYPTION_KEY`, `AWS_REGION`, `SQS_QUEUE_URL`, `AMAZON_LWA_CLIENT_ID`, `AMAZON_LWA_CLIENT_SECRET`), each with a one-line comment.

`src/env.ts`: implement `loadEnv()` reading `process.env`, throwing `Error` naming the first missing variable.

`src/index.ts`: for now, just `console.log("seller-hub starting"); loadEnv()` — later tasks wire in the real bootstrap (Task 13 replaces this body).

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @dtc/seller-hub test env.test.ts`
Expected: PASS

- [ ] **Step 5: Verify the workspace is picked up by Turbo**

Run: `yarn turbo build --filter=@dtc/seller-hub`
Expected: succeeds (no source files to compile yet beyond `env.ts`/`index.ts`, but `tsc` exits 0).

- [ ] **Step 6: Commit**

```bash
git add apps/seller-hub
git commit -m "feat(seller-hub): scaffold workspace with env loader"
```

---

## Task 2: Database schema, migration runner, and encryption helper

**Files:**
- Create: `apps/seller-hub/src/db/schema.sql`
- Create: `apps/seller-hub/src/db/migrate.ts`
- Create: `apps/seller-hub/src/db/client.ts`
- Create: `apps/seller-hub/src/crypto/secret-box.ts`
- Test: `apps/seller-hub/src/db/migrate.test.ts`
- Test: `apps/seller-hub/src/crypto/secret-box.test.ts`

**Interfaces:**
- Produces: `createPool(env: SellerHubEnv): pg.Pool` in `src/db/client.ts`.
- Produces: `runMigrations(pool: pg.Pool): Promise<void>` in `src/db/migrate.ts` — applies `schema.sql` idempotently (safe to call on every boot).
- Produces: `encrypt(plaintext: string, keyHex: string): string` and `decrypt(ciphertext: string, keyHex: string): string` in `src/crypto/secret-box.ts`, where `encrypt(decrypt(x)) === x` and the returned ciphertext is never equal to the plaintext.
- Consumes: `SellerHubEnv` from Task 1.

**Schema (`schema.sql`), exact DDL to implement:**

```sql
CREATE SCHEMA IF NOT EXISTS seller_hub;

CREATE TABLE IF NOT EXISTS seller_hub.integration_account (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace TEXT NOT NULL,              -- 'amazon'
  status TEXT NOT NULL DEFAULT 'disconnected', -- 'connected' | 'disconnected' | 'error'
  lwa_refresh_token_encrypted TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seller_hub.channel_listing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_account_id UUID NOT NULL REFERENCES seller_hub.integration_account(id),
  medusa_product_id TEXT NOT NULL,
  medusa_variant_id TEXT NOT NULL,
  external_sku TEXT NOT NULL,
  external_asin TEXT,
  status TEXT NOT NULL DEFAULT 'draft',   -- 'draft'|'pending'|'published'|'rejected'|'error'
  price_rule JSONB,                        -- e.g. {"type":"percentage","value":10}
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (integration_account_id, external_sku)
);

CREATE TABLE IF NOT EXISTS seller_hub.sync_job (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_account_id UUID NOT NULL REFERENCES seller_hub.integration_account(id),
  sync_type TEXT NOT NULL,                -- 'product'|'inventory'|'price'|'order'
  external_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'processing'|'succeeded'|'failed'
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  medusa_entity_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (integration_account_id, sync_type, external_id)
);
```

- [ ] **Step 1: Write the failing test for the encryption helper**

```ts
// src/crypto/secret-box.test.ts
test("decrypt(encrypt(x)) === x", () => {
  const key = "00".repeat(32) // 32-byte hex key
  const plaintext = "Atza|IwEBIxxxxx-refresh-token"
  const ciphertext = encrypt(plaintext, key)
  expect(ciphertext).not.toBe(plaintext)
  expect(decrypt(ciphertext, key)).toBe(plaintext)
})

test("decrypt throws on tampered ciphertext", () => {
  const key = "00".repeat(32)
  const ciphertext = encrypt("secret", key)
  const tampered = ciphertext.slice(0, -2) + "00"
  expect(() => decrypt(tampered, key)).toThrow()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @dtc/seller-hub test secret-box.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `encrypt`/`decrypt` in `src/crypto/secret-box.ts`**

Use Node's built-in `crypto` module, AES-256-GCM: random 12-byte IV per call, auth tag appended, output as a single base64 string (`iv:authTag:ciphertext`, base64-joined). `decrypt` must throw if the auth tag check fails (tamper detection is the test above).

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @dtc/seller-hub test secret-box.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for migrations**

```ts
// src/db/migrate.test.ts
test("runMigrations creates all three tables in the seller_hub schema", async () => {
  const pool = createPool(loadEnv())
  await runMigrations(pool)
  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'seller_hub' ORDER BY table_name`
  )
  expect(rows.map((r) => r.table_name)).toEqual([
    "channel_listing",
    "integration_account",
    "sync_job",
  ])
  await pool.end()
})

test("runMigrations is safe to call twice", async () => {
  const pool = createPool(loadEnv())
  await runMigrations(pool)
  await expect(runMigrations(pool)).resolves.not.toThrow()
  await pool.end()
})
```

This test runs against the real local Postgres instance (`DATABASE_URL` from `.env`, same instance Medusa uses — `medusa_test_project` database, separate `seller_hub` schema).

- [ ] **Step 6: Run test to verify it fails**

Run: `yarn workspace @dtc/seller-hub test migrate.test.ts`
Expected: FAIL — module not found / tables don't exist.

- [ ] **Step 7: Implement `createPool` and `runMigrations`**

`createPool`: `new pg.Pool({ connectionString: env.databaseUrl })`.
`runMigrations`: read `schema.sql`, execute it as one `pool.query(sql)` call — the `CREATE SCHEMA IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` statements make this naturally idempotent, no migration-tracking table needed for this fixed three-table schema.

- [ ] **Step 8: Run test to verify it passes**

Run: `yarn workspace @dtc/seller-hub test migrate.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/seller-hub/src/db apps/seller-hub/src/crypto
git commit -m "feat(seller-hub): database schema, migration runner, credential encryption"
```

---

## Task 3: SP-API rate limiter (token bucket)

**Files:**
- Create: `apps/seller-hub/src/sp-api/rate-limiter.ts`
- Test: `apps/seller-hub/src/sp-api/rate-limiter.test.ts`

**Interfaces:**
- Produces: `createTokenBucket(options: { ratePerSecond: number; burst: number }): { take(): Promise<void> }` — `take()` resolves immediately if a token is available, otherwise waits until the bucket refills enough for one token.

- [ ] **Step 1: Write the failing test**

```ts
import { vi } from "vitest"

test("take() resolves immediately while tokens are available", async () => {
  const bucket = createTokenBucket({ ratePerSecond: 1, burst: 2 })
  await bucket.take()
  await bucket.take() // both within burst, should not throw or hang
})

test("take() waits for refill once the bucket is empty", async () => {
  vi.useFakeTimers()
  const bucket = createTokenBucket({ ratePerSecond: 1, burst: 1 })
  await bucket.take() // consumes the only token
  const takePromise = bucket.take()
  let resolved = false
  takePromise.then(() => (resolved = true))
  await vi.advanceTimersByTimeAsync(500)
  expect(resolved).toBe(false) // not refilled yet at 0.5s with 1/s rate
  await vi.advanceTimersByTimeAsync(600)
  expect(resolved).toBe(true) // refilled by ~1.1s
  vi.useRealTimers()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @dtc/seller-hub test rate-limiter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `createTokenBucket`**

Standard token-bucket: track `tokens` (starts at `burst`) and `lastRefillAt`; on `take()`, compute elapsed time since last refill, add `elapsed * ratePerSecond` tokens capped at `burst`, then either consume one token and resolve, or `setTimeout` for the time until one token will exist and retry.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @dtc/seller-hub test rate-limiter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/seller-hub/src/sp-api/rate-limiter.ts apps/seller-hub/src/sp-api/rate-limiter.test.ts
git commit -m "feat(seller-hub): SP-API token-bucket rate limiter"
```

---

## Task 4: SP-API client — LWA auth + rate-limited request wrapper

**Files:**
- Create: `apps/seller-hub/src/sp-api/auth.ts`
- Create: `apps/seller-hub/src/sp-api/client.ts`
- Test: `apps/seller-hub/src/sp-api/auth.test.ts`
- Test: `apps/seller-hub/src/sp-api/client.test.ts`

**Interfaces:**
- Produces: `refreshAccessToken(input: { refreshToken: string; clientId: string; clientSecret: string }, fetchImpl: typeof fetch): Promise<{ accessToken: string; expiresAt: number }>` in `auth.ts` — POSTs to `https://api.amazon.com/auth/o2/token` with `grant_type=refresh_token`.
- Produces: `class SpApiClient` in `client.ts`:
  ```ts
  type SpApiOperation = {
    name: string                 // e.g. "getOrder" — used as the rate-limiter bucket key
    method: "GET" | "POST"
    path: string
    query?: Record<string, string>
    body?: unknown
    rateLimit: { ratePerSecond: number; burst: number }
  }

  class SpApiClient {
    constructor(config: {
      baseUrl: string             // SP-API regional endpoint
      refreshToken: string
      clientId: string
      clientSecret: string
      fetchImpl?: typeof fetch    // defaults to global fetch; tests inject a fake
    })
    request<T>(operation: SpApiOperation): Promise<T>
  }
  ```
  `request` injects the current access token (refreshing via `refreshAccessToken` when expired/absent), applies a per-`operation.name` token bucket (Task 3) before sending, and on a `429` or `5xx` response retries up to 3 times with exponential backoff reading `Retry-After` when present; on a `4xx` other than `429` it throws immediately without retrying.
- Consumes: `createTokenBucket` from Task 3.

- [ ] **Step 1: Write the failing test for `refreshAccessToken`**

```ts
test("refreshAccessToken posts grant_type=refresh_token and returns the access token", async () => {
  const fakeFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ access_token: "atza-fake", expires_in: 3600 }),
  })
  const result = await refreshAccessToken(
    { refreshToken: "Atzr|fake", clientId: "amzn1.application-oa2-client.fake", clientSecret: "fake" },
    fakeFetch as unknown as typeof fetch
  )
  expect(result.accessToken).toBe("atza-fake")
  expect(fakeFetch).toHaveBeenCalledWith(
    "https://api.amazon.com/auth/o2/token",
    expect.objectContaining({ method: "POST" })
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @dtc/seller-hub test auth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `refreshAccessToken`**

Form-encoded POST body: `grant_type=refresh_token&refresh_token=...&client_id=...&client_secret=...`. `expiresAt = Date.now() + expires_in * 1000`.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @dtc/seller-hub test auth.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing tests for `SpApiClient`**

```ts
test("request() retries once on 429 then succeeds", async () => {
  const fakeFetch = vi.fn()
    .mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ "Retry-After": "0" }), json: async () => ({}) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ orderId: "ORDER-1" }) })
  // also mock the token endpoint call inside refreshAccessToken via the same fakeFetch,
  // distinguishing by URL in the mock implementation
  const client = new SpApiClient({ baseUrl: "https://sandbox.sellingpartnerapi-na.amazon.com", refreshToken: "r", clientId: "c", clientSecret: "s", fetchImpl: fakeFetch })
  const result = await client.request({ name: "getOrder", method: "GET", path: "/orders/v0/orders/ORDER-1", rateLimit: { ratePerSecond: 10, burst: 10 } })
  expect(result).toEqual({ orderId: "ORDER-1" })
})

test("request() throws immediately on a non-429 4xx without retrying", async () => {
  const fakeFetch = vi.fn().mockResolvedValue({ ok: false, status: 400, headers: new Headers(), json: async () => ({ errors: [{ message: "bad request" }] }) })
  const client = new SpApiClient({ baseUrl: "https://sandbox.sellingpartnerapi-na.amazon.com", refreshToken: "r", clientId: "c", clientSecret: "s", fetchImpl: fakeFetch })
  await expect(client.request({ name: "getOrder", method: "GET", path: "/x", rateLimit: { ratePerSecond: 10, burst: 10 } })).rejects.toThrow()
  // exactly one call to the operation endpoint (plus the one token call) — no retry loop
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `yarn workspace @dtc/seller-hub test client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `SpApiClient`**

Hold one token bucket per distinct `operation.name` seen so far (lazily created with that operation's `rateLimit`). Cache the access token and its `expiresAt`; refresh when missing or within 60s of expiry. On response: `ok` → parse and return JSON; `status === 429` or `status >= 500` → retry (max 3 attempts, backoff `Math.min(2 ** attempt * 200, 5000)` ms, or the `Retry-After` header value in seconds if present); any other non-`ok` → throw an `Error` including the response status and body.

- [ ] **Step 8: Run test to verify it passes**

Run: `yarn workspace @dtc/seller-hub test client.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/seller-hub/src/sp-api/auth.ts apps/seller-hub/src/sp-api/client.ts apps/seller-hub/src/sp-api/auth.test.ts apps/seller-hub/src/sp-api/client.test.ts
git commit -m "feat(seller-hub): SP-API client with LWA auth and retry/backoff"
```

---

## Task 5: Medusa admin client

**Files:**
- Create: `apps/seller-hub/src/medusa/admin-client.ts`
- Test: `apps/seller-hub/src/medusa/admin-client.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type DraftOrderLineItemInput = { variant_id: string; quantity: number; unit_price?: number }

  class MedusaAdminClient {
    constructor(config: { baseUrl: string; email: string; password: string; fetchImpl?: typeof fetch })
    login(): Promise<void>  // POST /auth/user/emailpass, caches the returned token
    createDraftOrder(input: {
      sales_channel_id: string
      email: string
      items: DraftOrderLineItemInput[]
      shipping_address: Record<string, unknown>
      metadata: Record<string, unknown>
    }): Promise<{ id: string }>
    convertDraftOrderToOrder(draftOrderId: string): Promise<{ id: string }>
    findOrderByMetadata(key: string, value: string): Promise<{ id: string } | null>
  }
  ```
- Consumes: nothing from earlier tasks (standalone HTTP wrapper).

This task's tests run against the **real, already-running local Medusa backend** (`http://localhost:9000`) — no mocks. Before writing tests, confirm the backend is running (`curl http://localhost:9000/health`) and that a "Amazon" sales channel and at least one product/variant exist to test against.

- [ ] **Step 1: Create the "Amazon" sales channel via an exec script**

Create `apps/backend/src/scripts/setup-amazon-channel.ts`, following the exact pattern of the existing `apps/backend/src/scripts/setup-omnichannel.ts` (idempotent: checks for an existing "Amazon" sales channel by name before creating, using `createSalesChannelsWorkflow`). Run it:

Run: `cd apps/backend && npx medusa exec ./src/scripts/setup-amazon-channel.ts`
Expected: logs creation (or "already exists") of a sales channel named "Amazon"; note its `sc_...` ID for the tests below.

- [ ] **Step 2: Write the failing test for `login`**

```ts
test("login caches a bearer token usable for subsequent admin calls", async () => {
  const client = new MedusaAdminClient({ baseUrl: "http://localhost:9000", email: process.env.MEDUSA_ADMIN_EMAIL!, password: process.env.MEDUSA_ADMIN_PASSWORD! })
  await client.login()
  // indirectly verified by the createDraftOrder test below succeeding with a 2xx,
  // since an unauthenticated call would 401
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn workspace @dtc/seller-hub test admin-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `login` and the private authenticated-request helper**

`login()`: `POST {baseUrl}/auth/user/emailpass` with JSON body `{ email, password }`; response body is `{ token: string }` (per the route confirmed in the Medusa source) — store it. Add a private `authedFetch(path, init)` that attaches `Authorization: Bearer {token}`, calls `login()` first if no token cached, and re-calls `login()` once and retries on a `401`.

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn workspace @dtc/seller-hub test admin-client.test.ts`
Expected: PASS

- [ ] **Step 6: Write the failing tests for draft-order create/convert/lookup**

```ts
test("createDraftOrder then convertDraftOrderToOrder produces a real order", async () => {
  const client = new MedusaAdminClient({ baseUrl: "http://localhost:9000", email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  const draft = await client.createDraftOrder({
    sales_channel_id: AMAZON_SALES_CHANNEL_ID, // from Step 1
    email: "buyer@example.com",
    items: [{ variant_id: KNOWN_VARIANT_ID, quantity: 1 }], // a real variant from the demo catalog
    shipping_address: { first_name: "Jane", last_name: "Doe", address_1: "1 Test St", city: "Seattle", country_code: "us", postal_code: "98101" },
    metadata: { amazon_order_id: "TEST-ORDER-" + Date.now() },
  })
  expect(draft.id).toMatch(/^order_/)
  const order = await client.convertDraftOrderToOrder(draft.id)
  expect(order.id).toBe(draft.id)
})

test("findOrderByMetadata finds the order created above by its amazon_order_id", async () => {
  const client = new MedusaAdminClient({ baseUrl: "http://localhost:9000", email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  const amazonOrderId = "TEST-FINDBY-" + Date.now()
  const draft = await client.createDraftOrder({ /* ...same shape, metadata: { amazon_order_id: amazonOrderId } */ })
  await client.convertDraftOrderToOrder(draft.id)
  const found = await client.findOrderByMetadata("amazon_order_id", amazonOrderId)
  expect(found?.id).toBe(draft.id)
})

test("findOrderByMetadata returns null when nothing matches", async () => {
  const client = new MedusaAdminClient({ baseUrl: "http://localhost:9000", email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  const found = await client.findOrderByMetadata("amazon_order_id", "does-not-exist-" + Date.now())
  expect(found).toBeNull()
})
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `yarn workspace @dtc/seller-hub test admin-client.test.ts`
Expected: FAIL — methods not implemented.

- [ ] **Step 8: Implement `createDraftOrder`, `convertDraftOrderToOrder`, `findOrderByMetadata`**

`createDraftOrder`: `authedFetch("/admin/draft-orders", { method: "POST", body: JSON.stringify(input) })`, return `{ id: body.draft_order.id }`.
`convertDraftOrderToOrder`: `authedFetch(\`/admin/draft-orders/${draftOrderId}/convert-to-order\`, { method: "POST" })`, return `{ id: body.order.id }`.
`findOrderByMetadata`: `authedFetch(\`/admin/orders?metadata[${key}]=${encodeURIComponent(value)}&limit=1\`)`, return the first order in `body.orders` mapped to `{ id }`, or `null` if empty. (Confirm the exact query-param filtering syntax Medusa's `/admin/orders` route accepts for `metadata` by reading `packages/medusa/src/api/admin/orders/validators.ts` in StoreCentral before implementing — if `metadata` filtering isn't directly supported, fall back to filtering client-side over a small `limit`-bounded page, since this project is single-tenant with a modest order volume.)

- [ ] **Step 9: Run tests to verify they pass**

Run: `yarn workspace @dtc/seller-hub test admin-client.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add apps/backend/src/scripts/setup-amazon-channel.ts apps/seller-hub/src/medusa
git commit -m "feat(seller-hub): Medusa admin client for draft-order create/convert and order lookup"
```

---

## Task 6: Order import flow (Amazon → Medusa, idempotent)

**Files:**
- Create: `apps/seller-hub/src/sync/import-order.ts`
- Create: `apps/seller-hub/src/sync/types.ts`
- Test: `apps/seller-hub/src/sync/import-order.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  type NormalizedAmazonOrder = {
    amazonOrderId: string
    buyerEmail: string
    items: { sku: string; quantity: number }[]
    shippingAddress: { first_name: string; last_name: string; address_1: string; city: string; country_code: string; postal_code: string }
  }
  ```
- Produces (`import-order.ts`): `importAmazonOrder(order: NormalizedAmazonOrder, deps: { pool: pg.Pool; integrationAccountId: string; salesChannelId: string; medusaClient: MedusaAdminClient }): Promise<{ status: "created" | "skipped" | "needs_attention"; medusaOrderId?: string; reason?: string }>`
- Consumes: `MedusaAdminClient` from Task 5, the `seller_hub.channel_listing` / `seller_hub.sync_job` tables from Task 2.

This is the task the spec's Order Import data-flow section describes step-by-step; it's tested against the real local Medusa backend using fabricated `NormalizedAmazonOrder` values (no real Amazon call needed — Amazon-shape normalization is Task 10's job).

- [ ] **Step 1: Seed a channel_listing row for the test**

Before writing the test, insert one row into `seller_hub.channel_listing` mapping a known `external_sku` (e.g. `"TEST-SKU-1"`) to a real `medusa_variant_id` from the demo catalog (the same one used in Task 5's tests), via a test `beforeAll`/fixture helper — not product code, just test setup.

- [ ] **Step 2: Write the failing tests**

```ts
test("importAmazonOrder creates a real Medusa order on first import", async () => {
  const order: NormalizedAmazonOrder = {
    amazonOrderId: "TEST-IMPORT-" + Date.now(),
    buyerEmail: "buyer@example.com",
    items: [{ sku: "TEST-SKU-1", quantity: 1 }],
    shippingAddress: { first_name: "Jane", last_name: "Doe", address_1: "1 Test St", city: "Seattle", country_code: "us", postal_code: "98101" },
  }
  const result = await importAmazonOrder(order, deps)
  expect(result.status).toBe("created")
  expect(result.medusaOrderId).toBeDefined()
})

test("importAmazonOrder is idempotent — re-importing the same Amazon order is skipped", async () => {
  const order: NormalizedAmazonOrder = { amazonOrderId: "TEST-DUPE-" + Date.now(), buyerEmail: "buyer@example.com", items: [{ sku: "TEST-SKU-1", quantity: 1 }], shippingAddress: /* same shape */ }
  const first = await importAmazonOrder(order, deps)
  const second = await importAmazonOrder(order, deps)
  expect(first.status).toBe("created")
  expect(second.status).toBe("skipped")
  expect(second.medusaOrderId).toBe(first.medusaOrderId)
})

test("importAmazonOrder reports needs_attention for an unmapped SKU without creating a partial order", async () => {
  const order: NormalizedAmazonOrder = { amazonOrderId: "TEST-UNMAPPED-" + Date.now(), buyerEmail: "buyer@example.com", items: [{ sku: "NO-SUCH-SKU", quantity: 1 }], shippingAddress: /* same shape */ }
  const result = await importAmazonOrder(order, deps)
  expect(result.status).toBe("needs_attention")
  expect(result.reason).toMatch(/channel_listing|sku/i)
  expect(result.medusaOrderId).toBeUndefined()
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `yarn workspace @dtc/seller-hub test import-order.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `importAmazonOrder`**

1. Query `seller_hub.sync_job` for an existing row with `(integration_account_id, sync_type='order', external_id=order.amazonOrderId)`; if found and `status='succeeded'`, return `{ status: "skipped", medusaOrderId: row.medusa_entity_id }`.
2. Insert a `sync_job` row (`status='processing'`) — rely on the `UNIQUE (integration_account_id, sync_type, external_id)` constraint: if the insert conflicts (a concurrent/duplicate attempt), treat it the same as step 1's "already exists" path rather than erroring.
3. For each item, look up `seller_hub.channel_listing` by `(integration_account_id, external_sku=item.sku)`. If any SKU has no match, update the `sync_job` row to `status='failed'`, `last_error` describing the missing SKU, and return `{ status: "needs_attention", reason: "..." }` — no Medusa call made.
4. Map items to `DraftOrderLineItemInput[]` using each listing's `medusa_variant_id`.
5. `medusaClient.createDraftOrder({ sales_channel_id: deps.salesChannelId, email: order.buyerEmail, items, shipping_address: order.shippingAddress, metadata: { amazon_order_id: order.amazonOrderId } })`, then `medusaClient.convertDraftOrderToOrder(draft.id)`.
6. Update the `sync_job` row: `status='succeeded'`, `medusa_entity_id=realOrder.id`. Return `{ status: "created", medusaOrderId: realOrder.id }`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn workspace @dtc/seller-hub test import-order.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/seller-hub/src/sync
git commit -m "feat(seller-hub): idempotent Amazon order import into Medusa"
```

---

## Task 7: BullMQ queues with retry/backoff/dead-letter semantics

**Files:**
- Create: `apps/seller-hub/src/queue/connection.ts`
- Create: `apps/seller-hub/src/queue/queues.ts`
- Create: `apps/seller-hub/src/queue/sync-job-tracking.ts`
- Test: `apps/seller-hub/src/queue/queues.test.ts`

**Interfaces:**
- Produces (`connection.ts`): `createRedisConnection(env: SellerHubEnv): IORedis` (an `ioredis` instance configured for BullMQ).
- Produces (`queues.ts`):
  ```ts
  type SyncQueueName = "product-sync" | "inventory-sync" | "price-sync" | "order-sync"

  function createSyncQueue(name: SyncQueueName, connection: IORedis): Queue
  function createSyncWorker<T>(
    name: SyncQueueName,
    connection: IORedis,
    processor: (job: Job<T>) => Promise<void>,
    options?: { attempts?: number }
  ): Worker<T>
  ```
  Default `attempts: 5`, `backoff: { type: "exponential", delay: 1000 }` (BullMQ's built-in jitter-capable exponential backoff). A processor that throws an error whose `.name === "PermanentSyncError"` must not be retried (BullMQ's `UnrecoverableError` — wrap it).
- Produces (`sync-job-tracking.ts`): `markSyncJobFailed(pool: pg.Pool, syncJobId: string, error: string): Promise<void>` and `markSyncJobSucceeded(pool: pg.Pool, syncJobId: string, medusaEntityId?: string): Promise<void>` — thin wrappers updating `seller_hub.sync_job`, used by every worker task from here on so job outcome bookkeeping isn't duplicated per worker.
- Consumes: `seller_hub.sync_job` table from Task 2.

- [ ] **Step 1: Write the failing tests**

```ts
test("a processor that fails twice then succeeds eventually completes the job", async () => {
  const connection = createRedisConnection(loadEnv())
  const queue = createSyncQueue("inventory-sync", connection)
  let attempts = 0
  const worker = createSyncWorker("inventory-sync", connection, async () => {
    attempts++
    if (attempts < 3) throw new Error("transient")
  }, { attempts: 5 })
  const job = await queue.add("test", { foo: "bar" })
  await job.waitUntilFinished(new QueueEvents("inventory-sync", { connection }))
  expect(attempts).toBe(3)
  await worker.close()
  await queue.close()
})

test("a processor that throws PermanentSyncError is not retried", async () => {
  const connection = createRedisConnection(loadEnv())
  const queue = createSyncQueue("price-sync", connection)
  let attempts = 0
  const worker = createSyncWorker("price-sync", connection, async () => {
    attempts++
    throw new PermanentSyncError("bad request")
  })
  const job = await queue.add("test", {})
  const events = new QueueEvents("price-sync", { connection })
  await expect(job.waitUntilFinished(events)).rejects.toThrow()
  expect(attempts).toBe(1) // no retry
  await worker.close()
  await queue.close()
})

test("a processor that always throws a transient error exhausts its attempts and the job ends failed", async () => {
  const connection = createRedisConnection(loadEnv())
  const queue = createSyncQueue("order-sync", connection)
  let attempts = 0
  const worker = createSyncWorker("order-sync", connection, async () => {
    attempts++
    throw new Error("still transient")
  }, { attempts: 3 })
  const job = await queue.add("test", {})
  const events = new QueueEvents("order-sync", { connection })
  await expect(job.waitUntilFinished(events)).rejects.toThrow()
  expect(attempts).toBe(3) // exhausted the attempt cap, then stopped — not infinite
  const finalState = await job.getState()
  expect(finalState).toBe("failed")
  await worker.close()
  await queue.close()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @dtc/seller-hub test queues.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `createRedisConnection`, `createSyncQueue`, `createSyncWorker`, and export `PermanentSyncError`**

`PermanentSyncError extends Error` (exported from `queues.ts`). In `createSyncWorker`'s processor wrapper, catch errors from the user-supplied `processor`; if `error instanceof PermanentSyncError`, re-throw a BullMQ `UnrecoverableError` with the same message (BullMQ skips retrying `UnrecoverableError`); otherwise re-throw as-is so BullMQ's normal backoff retry applies.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn workspace @dtc/seller-hub test queues.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for `sync-job-tracking`**

```ts
test("markSyncJobFailed sets status=failed and records the error", async () => {
  const pool = createPool(loadEnv())
  const jobId = await insertTestSyncJob(pool) // test helper: inserts a pending sync_job row, returns its id
  await markSyncJobFailed(pool, jobId, "boom")
  const { rows } = await pool.query("SELECT status, last_error FROM seller_hub.sync_job WHERE id = $1", [jobId])
  expect(rows[0]).toEqual({ status: "failed", last_error: "boom" })
  await pool.end()
})
```

- [ ] **Step 6: Run test to verify it fails, then implement and re-run to verify it passes**

Run: `yarn workspace @dtc/seller-hub test sync-job-tracking.test.ts` (FAIL, then implement the two thin `UPDATE` functions, then PASS).

- [ ] **Step 7: Commit**

```bash
git add apps/seller-hub/src/queue
git commit -m "feat(seller-hub): BullMQ sync queues with retry/backoff and dead-letter via sync_job"
```

---

## Task 8: Inventory, price, and product sync workers (push to Amazon, SP-API mocked)

**Files:**
- Create: `apps/seller-hub/src/sp-api/listings.ts`
- Create: `apps/seller-hub/src/sp-api/pricing.ts`
- Create: `apps/seller-hub/src/sync/push-inventory.ts`
- Create: `apps/seller-hub/src/sync/push-price.ts`
- Create: `apps/seller-hub/src/sync/push-product.ts`
- Test: `apps/seller-hub/src/sync/push-inventory.test.ts`
- Test: `apps/seller-hub/src/sync/push-price.test.ts`
- Test: `apps/seller-hub/src/sync/push-product.test.ts`

**Interfaces:**
- Produces (`sp-api/listings.ts`): `submitListingFeed(client: SpApiClient, input: { sku: string; asin?: string; attributes: Record<string, unknown> }): Promise<{ feedId: string }>` and `getFeedResult(client: SpApiClient, feedId: string): Promise<{ status: "DONE" | "IN_PROGRESS" | "CANCELLED" | "FATAL"; errors?: string[] }>`.
- Produces (`sp-api/pricing.ts`): `submitPriceUpdate(client: SpApiClient, input: { sku: string; amount: number; currencyCode: string }): Promise<{ feedId: string }>`.
- Produces (`sync/push-inventory.ts`): `pushInventoryUpdate(deps: { pool: pg.Pool; medusaClient: MedusaAdminClient; spApiClient: SpApiClient; integrationAccountId: string; channelListingId: string }): Promise<void>` — reads the Medusa variant's current stock via `medusaClient` (new method, see Step 3 below), submits it via `submitListingFeed` (inventory is part of the Listings feed in SP-API), updates `sync_job`.
- Produces (`sync/push-price.ts`): `pushPriceUpdate(deps: { ...same shape... }): Promise<void>` — reads the Medusa variant's current price, applies `channel_listing.price_rule` (percentage or fixed, per the spec's example), submits via `submitPriceUpdate`, updates `sync_job`.
- Produces (`sync/push-product.ts`): `pushProductListing(deps: { ...same shape... }): Promise<void>` — moves `channel_listing.status` through `draft → pending`, submits via `submitListingFeed`, polls `getFeedResult`, lands on `published` or `rejected` (with `last_error` set from `errors`).
- Consumes: `SpApiClient` (Task 4), `MedusaAdminClient` (Task 5), `PermanentSyncError`/`markSyncJobFailed`/`markSyncJobSucceeded` (Task 7).

- [ ] **Step 1: Write the failing test for `pushPriceUpdate`'s rule application**

```ts
test("pushPriceUpdate applies a percentage markup from channel_listing.price_rule before submitting", async () => {
  // fixture: channel_listing row with price_rule = { type: "percentage", value: 10 }, mapped to a variant with a known Medusa price of 29.99
  const fakeSpApiClient = { request: vi.fn() } // submitPriceUpdate is implemented via spApiClient.request under the hood
  await pushPriceUpdate({ pool, medusaClient: realMedusaClientReadingLocalBackend, spApiClient: fakeSpApiClient as unknown as SpApiClient, integrationAccountId, channelListingId })
  // assert the submitted amount is 29.99 * 1.10 = 32.99 (rounded to 2 decimals)
  const call = fakeSpApiClient.request.mock.calls[0][0]
  expect(call.body).toEqual(expect.objectContaining({ /* amount reflecting 32.99 */ }))
})

test("pushPriceUpdate marks sync_job failed (no retry) on a permanent SP-API rejection", async () => {
  const fakeSpApiClient = { request: vi.fn().mockRejectedValue(new Error("400: invalid price")) }
  await expect(pushPriceUpdate({ /* ... */ })).rejects.toThrow(PermanentSyncError)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @dtc/seller-hub test push-price.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Add `getVariantPricing(variantId): Promise<{ amount: number; currencyCode: string }>` and `getVariantInventory(variantId): Promise<{ quantity: number }>` to `MedusaAdminClient` (extends Task 5)**

Read via Medusa's existing Admin API: `GET /admin/products/variants/{id}?fields=*prices` for pricing (or the equivalent nested product query — confirm the exact `fields` syntax against `packages/medusa/src/api/admin/products/variants` in StoreCentral before implementing), and `GET /admin/inventory-items?...` filtered by the variant's linked inventory item for stock. Add corresponding unit tests against the real local backend following the same pattern as Task 5.

- [ ] **Step 4: Implement `submitListingFeed`/`getFeedResult`/`submitPriceUpdate` and `pushInventoryUpdate`/`pushPriceUpdate`/`pushProductListing`**

Each `push*` function: read current Medusa state, call the relevant SP-API function, and on success call `markSyncJobSucceeded`; on a caught error, call `markSyncJobFailed` and re-throw as `PermanentSyncError` for 4xx-class failures (so Task 7's worker doesn't retry) or the original error for everything else (so it does).

- [ ] **Step 5: Run all three test files to verify they pass**

Run: `yarn workspace @dtc/seller-hub test push-inventory.test.ts push-price.test.ts push-product.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/seller-hub/src/sp-api/listings.ts apps/seller-hub/src/sp-api/pricing.ts apps/seller-hub/src/sync/push-inventory.ts apps/seller-hub/src/sync/push-price.ts apps/seller-hub/src/sync/push-product.ts
git commit -m "feat(seller-hub): inventory/price/product sync workers pushing to Amazon"
```

---

## Task 9: Webhook receiver + Medusa subscriber (inventory/price change trigger)

**Files:**
- Create: `apps/seller-hub/src/webhook/server.ts`
- Create: `apps/backend/src/subscribers/seller-hub-sync.ts`
- Test: `apps/seller-hub/src/webhook/server.test.ts`

**Interfaces:**
- Produces: `createWebhookServer(deps: { inventoryQueue: Queue; priceQueue: Queue }): http.Server` — exposes `POST /webhooks/medusa` expecting JSON body `{ event: string; data: { id: string } }`; routes to `inventoryQueue.add(...)` when `event` starts with `inventory-level.`, to `priceQueue.add(...)` when it starts with a price-related event name (confirmed in Step 1 below), responds `200` on success and `400` on a malformed body (missing `event` or `data.id`) without crashing the process.

- [ ] **Step 1: Discover the exact Medusa event names (runtime verification, not guesswork)**

With the local backend running, add a temporary throwaway subscriber (`apps/backend/src/subscribers/_tmp-log-all.ts`) that calls `subscribe({ event: "*", ... })` or listens to the specific candidate names `inventory-level.updated` and a price-related candidate (check `packages/modules/pricing/src/services` or `packages/modules/product` for the exact object name the generated events use — e.g. `price-list.updated` or `product-variant.updated`, by grepping for `@EmitEvents()` usages and the model's class name, the same way this plan's author confirmed the naming convention via `buildModuleResourceEventName`). Trigger a real inventory update (e.g. via `POST /admin/inventory-items/{id}/location-levels/{location_id}`) and a real price update through the Admin API, and log the event names that actually fire. Delete the throwaway subscriber once confirmed. Record the two confirmed literal event names as constants in `apps/backend/src/subscribers/seller-hub-sync.ts` (Step 4) — do not hardcode a guessed name anywhere else.

- [ ] **Step 2: Write the failing test for the webhook server**

```ts
test("POST /webhooks/medusa with an inventory event enqueues an inventory-sync job", async () => {
  const inventoryQueue = { add: vi.fn() } as unknown as Queue
  const priceQueue = { add: vi.fn() } as unknown as Queue
  const server = createWebhookServer({ inventoryQueue, priceQueue })
  server.listen(0)
  const port = (server.address() as AddressInfo).port
  const res = await fetch(`http://localhost:${port}/webhooks/medusa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "inventory-level.updated", data: { id: "ilev_123" } }),
  })
  expect(res.status).toBe(200)
  expect(inventoryQueue.add).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ inventoryLevelId: "ilev_123" }))
  server.close()
})

test("POST /webhooks/medusa with a malformed body returns 400 and does not crash", async () => {
  const server = createWebhookServer({ inventoryQueue: { add: vi.fn() } as unknown as Queue, priceQueue: { add: vi.fn() } as unknown as Queue })
  server.listen(0)
  const port = (server.address() as AddressInfo).port
  const res = await fetch(`http://localhost:${port}/webhooks/medusa`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "not json" })
  expect(res.status).toBe(400)
  server.close()
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `yarn workspace @dtc/seller-hub test server.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `createWebhookServer`**

Plain `node:http` server (matches this repo's existing `apps/pos/server.js` convention — no new HTTP framework dependency). Parse the body inside a `try/catch`; on parse failure or missing `event`/`data.id`, respond `400` and return (never throw uncaught). On a recognized event, `queue.add(event, { ...data })` and respond `200`; on an unrecognized `event`, respond `200` anyway (ignored, not an error — a forward-compatible no-op) rather than `400`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn workspace @dtc/seller-hub test server.test.ts`
Expected: PASS

- [ ] **Step 6: Implement the Medusa subscriber**

`apps/backend/src/subscribers/seller-hub-sync.ts` — using the confirmed event name constants from Step 1, subscribe to both events and `fetch(process.env.SELLER_HUB_WEBHOOK_URL + "/webhooks/medusa", { method: "POST", body: JSON.stringify({ event, data }) })`. Wrap the fetch in a `try/catch` that logs on failure but never throws — a Seller Hub outage must not break Medusa's own event processing (per the spec's blast-radius requirement). Add `SELLER_HUB_WEBHOOK_URL` to `apps/backend/.env`.

- [ ] **Step 7: Manually verify the subscriber fires against the running backend**

With both the Medusa backend and a locally-running `apps/seller-hub` webhook server up, trigger a real inventory update via the Admin API and confirm (via a log line in `createWebhookServer`'s handler) that the webhook receiver was called.

- [ ] **Step 8: Commit**

```bash
git add apps/seller-hub/src/webhook apps/backend/src/subscribers/seller-hub-sync.ts apps/backend/.env
git commit -m "feat(seller-hub): webhook receiver and Medusa subscriber for inventory/price change events"
```

---

## Task 10: SQS consumer (Amazon → Seller Hub notification intake)

**Files:**
- Create: `apps/seller-hub/src/sqs/consumer.ts`
- Create: `apps/seller-hub/src/sp-api/orders.ts`
- Test: `apps/seller-hub/src/sqs/consumer.test.ts`

**Interfaces:**
- Produces (`sp-api/orders.ts`): `getOrder(client: SpApiClient, amazonOrderId: string): Promise<NormalizedAmazonOrder>` — calls SP-API's Orders API and maps the response into the `NormalizedAmazonOrder` shape from Task 6.
- Produces (`sqs/consumer.ts`):
  ```ts
  type SqsClientLike = {
    receiveMessage(input: { QueueUrl: string; MaxNumberOfMessages: number; WaitTimeSeconds: number }): Promise<{ Messages?: { Body: string; ReceiptHandle: string }[] }>
    deleteMessage(input: { QueueUrl: string; ReceiptHandle: string }): Promise<void>
  }

  class SqsConsumer {
    constructor(deps: { sqsClient: SqsClientLike; queueUrl: string; onOrderChange: (amazonOrderId: string) => Promise<void> })
    pollOnce(): Promise<void>  // processes whatever messages are currently available, then returns — used directly in tests instead of a long-running loop
    start(): void   // repeatedly calls pollOnce() on an interval; used by Task 13's bootstrap
    stop(): void
  }
  ```
  A malformed message body (not JSON, or missing the expected `OrderID` field) is logged and the message is still deleted (so it doesn't block the queue forever) rather than crashing the consumer.

- [ ] **Step 1: Write the failing tests**

```ts
test("pollOnce calls onOrderChange for each ORDER_CHANGE notification and deletes the message", async () => {
  const fakeSqs: SqsClientLike = {
    receiveMessage: vi.fn().mockResolvedValue({
      Messages: [{ Body: JSON.stringify({ NotificationType: "ORDER_CHANGE", Payload: { OrderChangeNotification: { AmazonOrderId: "ORDER-ABC" } } }), ReceiptHandle: "rh-1" }],
    }),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  }
  const onOrderChange = vi.fn().mockResolvedValue(undefined)
  const consumer = new SqsConsumer({ sqsClient: fakeSqs, queueUrl: "https://sqs.fake/queue", onOrderChange })
  await consumer.pollOnce()
  expect(onOrderChange).toHaveBeenCalledWith("ORDER-ABC")
  expect(fakeSqs.deleteMessage).toHaveBeenCalledWith({ QueueUrl: "https://sqs.fake/queue", ReceiptHandle: "rh-1" })
})

test("pollOnce deletes and skips a malformed message without throwing", async () => {
  const fakeSqs: SqsClientLike = {
    receiveMessage: vi.fn().mockResolvedValue({ Messages: [{ Body: "not json", ReceiptHandle: "rh-2" }] }),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  }
  const onOrderChange = vi.fn()
  const consumer = new SqsConsumer({ sqsClient: fakeSqs, queueUrl: "https://sqs.fake/queue", onOrderChange })
  await expect(consumer.pollOnce()).resolves.not.toThrow()
  expect(onOrderChange).not.toHaveBeenCalled()
  expect(fakeSqs.deleteMessage).toHaveBeenCalledWith({ QueueUrl: "https://sqs.fake/queue", ReceiptHandle: "rh-2" })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @dtc/seller-hub test consumer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `SqsConsumer`**

`pollOnce()`: call `receiveMessage` with `MaxNumberOfMessages: 10, WaitTimeSeconds: 1`; for each message, `try` to `JSON.parse(Body)` and read `Payload.OrderChangeNotification.AmazonOrderId` (the exact SQS envelope shape per Amazon's Notifications API — confirm against current SP-API Notifications docs before finalizing, since this plan's web research did not pin the exact payload schema). On success, `await onOrderChange(amazonOrderId)`, then always `deleteMessage` (in a `finally`, so a malformed body still gets removed — matches the second test). `start()`/`stop()`: a `setInterval` wrapper around `pollOnce()`, guarding against overlapping polls.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn workspace @dtc/seller-hub test consumer.test.ts`
Expected: PASS

- [ ] **Step 5: Implement `getOrder` (SP-API Orders API wrapper)**

Call `client.request({ name: "getOrder", method: "GET", path: \`/orders/v0/orders/${amazonOrderId}\`, rateLimit: { ratePerSecond: 0.0167, burst: 20 } })` (rate values marked in a code comment as "confirm against current SP-API published rate table before production use" per the spec's Open Items — do not treat these as verified). Map the response's order + line items + shipping address into `NormalizedAmazonOrder`. No automated test against real Amazon; this function is exercised for real only in Task 13's manual smoke checklist.

```ts
test("getOrder maps a raw SP-API order response into NormalizedAmazonOrder", async () => {
  const fakeSpApiClient = {
    request: vi.fn().mockResolvedValue({
      AmazonOrderId: "ORDER-ABC",
      BuyerInfo: { BuyerEmail: "buyer@example.com" },
      ShippingAddress: { Name: "Jane Doe", AddressLine1: "1 Test St", City: "Seattle", CountryCode: "US", PostalCode: "98101" },
      OrderItems: [{ SellerSKU: "TEST-SKU-1", QuantityOrdered: 2 }],
    }),
  } as unknown as SpApiClient
  const result = await getOrder(fakeSpApiClient, "ORDER-ABC")
  expect(result).toEqual({
    amazonOrderId: "ORDER-ABC",
    buyerEmail: "buyer@example.com",
    items: [{ sku: "TEST-SKU-1", quantity: 2 }],
    shippingAddress: { first_name: "Jane", last_name: "Doe", address_1: "1 Test St", city: "Seattle", country_code: "us", postal_code: "98101" },
  })
})
```

(The exact field names above — `BuyerInfo.BuyerEmail`, `OrderItems[].SellerSKU`, etc. — follow SP-API's documented Orders API response shape; confirm them against the current Orders API reference before implementing, same caveat as the rate limits.)

- [ ] **Step 6: Wire the consumer's `onOrderChange` to `getOrder` + `importAmazonOrder` + the order-sync queue**

In `src/sqs/consumer.ts`'s intended real usage (wired in Task 13, not inside the class itself — keep `SqsConsumer` dependency-free of the import/queue logic per its existing constructor shape): `onOrderChange` becomes `(amazonOrderId) => orderSyncQueue.add("import", { amazonOrderId })`, and a `createSyncWorker("order-sync", ..., async (job) => { const order = await getOrder(spApiClient, job.data.amazonOrderId); await importAmazonOrder(order, deps) })` processor — this wiring is written here as a documented pattern but actually assembled in Task 13.

- [ ] **Step 7: Commit**

```bash
git add apps/seller-hub/src/sqs apps/seller-hub/src/sp-api/orders.ts
git commit -m "feat(seller-hub): SQS consumer and SP-API Orders mapping for order import"
```

---

## Task 11: Scheduled reconciliation

**Files:**
- Create: `apps/seller-hub/src/sync/reconcile.ts`
- Test: `apps/seller-hub/src/sync/reconcile.test.ts`

**Interfaces:**
- Produces: `reconcile(deps: { pool: pg.Pool; medusaClient: MedusaAdminClient; integrationAccountId: string; inventoryQueue: Queue; priceQueue: Queue }): Promise<{ driftFound: number }>` — for every `channel_listing` row belonging to the account, re-reads current Medusa inventory/price and compares against what `last_synced_at`/the listing's last known pushed values suggest; for each mismatch, enqueues a corrective job on the appropriate queue (reusing Task 8's workers) rather than pushing directly, so reconciliation goes through the same retry/idempotency path as the webhook-triggered flow.
- Produces: `scheduleReconciliation(queue: Queue, everyMs: number): Promise<void>` — adds a BullMQ repeatable job (`queue.add("reconcile", {}, { repeat: { every: everyMs } })`).

To know "what was last pushed" without re-fetching Amazon's current state (out of scope for this sub-project's product-sync-only Listings integration), reconciliation here compares Medusa's current inventory/price against the value captured in `channel_listing` at the time of the last successful `sync_job` for that listing — add a `last_synced_quantity INT` and `last_synced_price NUMERIC` column to `channel_listing` (a small schema addition to Task 2's table, made here since this is where it's first needed) that Task 8's `pushInventoryUpdate`/`pushPriceUpdate` update on success.

- [ ] **Step 1: Extend the schema**

Add to `schema.sql` (Task 2): `ALTER TABLE seller_hub.channel_listing ADD COLUMN IF NOT EXISTS last_synced_quantity INT;` and `ADD COLUMN IF NOT EXISTS last_synced_price NUMERIC;`. Update `pushInventoryUpdate`/`pushPriceUpdate` (Task 8) to set these on success — this is a small retrofit to Task 8's implementation, noted here since reconciliation is what requires it.

- [ ] **Step 2: Write the failing test**

```ts
test("reconcile enqueues an inventory-sync job when Medusa's stock differs from last_synced_quantity", async () => {
  // fixture: a channel_listing row with last_synced_quantity = 10, mapped to a variant whose
  // real current Medusa inventory (via the real local backend) is a different number, e.g. 7
  const inventoryQueue = { add: vi.fn() } as unknown as Queue
  const priceQueue = { add: vi.fn() } as unknown as Queue
  const result = await reconcile({ pool, medusaClient: realMedusaClient, integrationAccountId, inventoryQueue, priceQueue })
  expect(result.driftFound).toBeGreaterThanOrEqual(1)
  expect(inventoryQueue.add).toHaveBeenCalled()
})

test("reconcile finds no drift and enqueues nothing when values match", async () => {
  // fixture: last_synced_quantity exactly equal to current Medusa stock
  const inventoryQueue = { add: vi.fn() } as unknown as Queue
  const priceQueue = { add: vi.fn() } as unknown as Queue
  const result = await reconcile({ pool, medusaClient: realMedusaClient, integrationAccountId, inventoryQueue, priceQueue })
  expect(result.driftFound).toBe(0)
  expect(inventoryQueue.add).not.toHaveBeenCalled()
})
```

- [ ] **Step 3: Run tests to verify they fail, implement, re-run to verify they pass**

Run: `yarn workspace @dtc/seller-hub test reconcile.test.ts` (FAIL, implement `reconcile` by iterating `channel_listing` rows for the account and comparing via `medusaClient.getVariantInventory`/`getVariantPricing` from Task 8, then PASS).

- [ ] **Step 4: Commit**

```bash
git add apps/seller-hub/src/sync/reconcile.ts apps/seller-hub/src/db/schema.sql
git commit -m "feat(seller-hub): scheduled reconciliation for inventory/price drift"
```

---

## Task 12: Process bootstrap

**Files:**
- Modify: `apps/seller-hub/src/index.ts`
- Create: `apps/seller-hub/README.md`

**Interfaces:**
- Consumes: every module produced by Tasks 1–11.

- [ ] **Step 1: Wire the real bootstrap in `src/index.ts`**

In order: `loadEnv()` → `createPool` + `runMigrations` → `createRedisConnection` → the four `createSyncQueue`s → `createSyncWorker` for each (order-sync's processor calls `getOrder` then `importAmazonOrder`; inventory/price/product-sync processors call their respective `push*` function from Task 8) → `createWebhookServer({ inventoryQueue, priceQueue }).listen(...)` → construct the real `SqsClient` from `@aws-sdk/client-sqs`, wrap it to match `SqsClientLike`, construct `SqsConsumer`, call `.start()` → `scheduleReconciliation(inventoryQueue, 60 * 60 * 1000)` (hourly, per the spec's "scheduled reconciliation" principle — exact interval left as a sensible default, adjustable via env later if needed).

- [ ] **Step 2: Verify the process boots cleanly against local infra**

Run: `yarn workspace @dtc/seller-hub dev`
Expected: logs showing migrations applied, webhook server listening, workers started, SQS consumer started (it will log `receiveMessage` failures if `SQS_QUEUE_URL` points at a placeholder — expected and non-fatal until Task 13's prerequisites are met; the process must stay up, not crash).

- [ ] **Step 3: Write `README.md`**

Document: what this service does (one paragraph, linking the spec), how to run it locally (env vars, `yarn workspace @dtc/seller-hub dev`), and explicitly list the two external prerequisites from the spec's Open Items (AWS account/SQS queue; Amazon SP-API app approval) as what's needed before the manual smoke checklist (Task 13) can run for real.

- [ ] **Step 4: Commit**

```bash
git add apps/seller-hub/src/index.ts apps/seller-hub/README.md
git commit -m "feat(seller-hub): wire full bootstrap (queues, workers, webhook server, SQS consumer, reconciliation)"
```

---

## Task 13: Manual smoke checklist (gated on external prerequisites)

This task has no automated steps — it's the spec's required manual verification pass, and it cannot run until the user has: (a) an AWS account with an SQS queue provisioned and its URL in `.env`, and (b) Amazon SP-API app approval with a refresh token for at least one sandbox/test seller account. Both are flagged in the spec as outside this project's control.

**Files:** none (verification only).

- [ ] **Step 1: Confirm prerequisites are met**

Check `.env` has real (non-placeholder) values for `SQS_QUEUE_URL`, `AWS_REGION`, `AMAZON_LWA_CLIENT_ID`, `AMAZON_LWA_CLIENT_SECRET`, and a real `lwa_refresh_token_encrypted` has been stored for the `integration_account` row (via a small one-off script using Task 2's `encrypt()`, or inserted directly — document whichever is used).

- [ ] **Step 2: Product listing**

Trigger `pushProductListing` for a real demo product against the real Amazon sandbox. Confirm `channel_listing.status` reaches `published` (or capture the actual rejection reason if not, and note it — sandbox listing requirements may need adjustment, which is expected to surface here for the first time).

- [ ] **Step 3: Inventory & price push**

Change a product's stock/price in the running Medusa admin; confirm (via logs) the subscriber fires, the webhook receiver enqueues a job, and the job reaches Amazon (check `sync_job.status = 'succeeded'`).

- [ ] **Step 4: Order import**

Place a real test order against the Amazon sandbox seller account. Confirm the SQS notification arrives, `SqsConsumer` processes it, and a real Medusa order appears (`GET /admin/orders`) with `metadata.amazon_order_id` set. Re-deliver the same SQS message manually (or trigger Amazon to resend) and confirm no duplicate order is created.

- [ ] **Step 5: Record findings and capture replay fixtures**

Update the spec's "Open items" section (or a new short note alongside it) with whatever was actually confirmed here — exact SP-API rate limits observed, the exact SQS notification payload shape, and any sandbox-specific quirks — so the next marketplace integration (eBay/Walmart) doesn't have to rediscover them. Save the real (sanitized — strip any real customer PII) SQS notification body and SP-API order response captured during Step 4 as fixture files alongside Task 10's tests, and add one more `consumer.test.ts`/`orders.test.ts` case that replays each real fixture through `SqsConsumer.pollOnce`/`getOrder` — this is the spec's "replay tests" requirement, deliberately done here rather than as its own earlier task since it has nothing to replay until real payloads exist.

No commit for this task beyond Step 5's documentation update, since it's verification, not new code.
