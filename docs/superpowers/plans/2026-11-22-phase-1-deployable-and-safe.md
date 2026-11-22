# Phase 1: Deployable and Safe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run all StoreCentral services from one Docker Compose stack, with Redis-backed backend runtime modules, health checks, CI, test-database guards, a startup secret check and an operations runbook.

**Architecture:** Additive only. A config builder switches the backend to Redis event bus, workflow engine and locking behind `BACKEND_REDIS_MODULES`; images and compose live under `deploy/`; guards and `/health` are small code additions. No business behaviour, no `packages/**` change.

**Tech Stack:** Medusa 2.21.2 (vendored), Node 22, Yarn 3.2.1 workspaces, Docker Compose v2, Caddy, GitHub Actions, Jest (backend), Vitest (seller-hub), PostgreSQL 15, Redis.

**Spec:** `docs/superpowers/specs/2026-11-22-phase-1-deployable-and-safe-design.md`

## Global Constraints

- Never read, print, copy or commit values from any `.env`; document names only; templates are `.env.template` / `deploy/.env.example`.
- Never write to, migrate, or delete from the user's dev database. Any database a test or script touches is a throwaway whose name ends in `_test` (or a compose volume).
- `yarn dev` behaviour is unchanged when `BACKEND_REDIS_MODULES` is not `true`.
- No change under `packages/**`. No new lockfile; add dependencies only inside the app that needs them with `yarn`.
- Style: no semicolons, double quotes, 2-space indent, kebab-case files, no emojis (AGENTS.md). Do not disable any `@medusajs/*` lint rule.
- No marketplace calls, no real AWS or Stripe calls, no push, no merge.
- Run `yarn` commands from the app directory they belong to.

## Review Focus

- A secret value appearing in a log, image layer, compose file or CI output (test: `check-env` output contains names only; `.dockerignore` excludes `.env*`).
- Seller-hub internal API reachable from outside the compose network (test: compose publishes only Caddy ports).
- Unset `TEST_DATABASE_URL` or a non-`_test` database must abort test runs, not pass silently.
- Default dev workflow with the flag off still resolves in-memory modules.
- Flag on but `REDIS_URL` missing fails fast with a clear message.
- `/health` must not reveal versions, hosts or credentials in either 200 or 503 bodies.

---

### Task 1: Find and stop the test writes to the dev database

**Files:**
- Create: `apps/seller-hub/src/test-support/database-guard.ts`
- Create: `apps/seller-hub/src/test-support/database-guard.test.ts`
- Create: `apps/seller-hub/src/test-support/vitest-setup.ts`
- Modify: `apps/seller-hub/vitest.config.ts` (add `setupFiles`, stop loading real `.env` values into `DATABASE_URL`)
- Modify: `apps/seller-hub/src/db/migrate.test.ts` (use the test database)
- Modify: `apps/seller-hub/.env.example` (document `TEST_DATABASE_URL`)

**Interfaces:**
- Produces: `assertTestDatabase(url: string | undefined): string` returns the url when its database name ends in `_test`; throws `Error` with a message naming `TEST_DATABASE_URL` otherwise (never includes the URL, since it may hold a password). `vitest-setup.ts` runs before every test file and, if `TEST_DATABASE_URL` is set, copies it to `process.env.DATABASE_URL`; if unset it deletes `process.env.DATABASE_URL` so any test that needs a real database fails loudly.

- [ ] **Step 1: Confirm the source (read-only).** Read `src/db/migrate.test.ts` and `src/connectors/connections.e2e.test.ts`; record in the commit message which test opens `createPool(loadEnv())` against the real database and whether it inserts an Amazon `integration_account` row. Do not query or modify the dev database.
- [ ] **Step 2: Write the failing tests** in `database-guard.test.ts`: `assertTestDatabase("postgres://u:p@h:5432/app_test")` returns the input; `".../app"`, `".../app_test_backup"`, `undefined` and `""` each throw; the thrown message mentions `TEST_DATABASE_URL` and does not contain `"p@h"`.
- [ ] **Step 3: Run:** `cd apps/seller-hub && yarn vitest run src/test-support/database-guard.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 4: Implement** `assertTestDatabase` (parse with `new URL`, take the last path segment, require suffix `_test`) and `vitest-setup.ts` as described above; wire `setupFiles` in `vitest.config.ts` and remove the `loadEnv(mode...)` copy of `DATABASE_URL`, `REDIS_URL`, `ENCRYPTION_KEY` into `process.env` (tests that need them must set them, or skip when `TEST_DATABASE_URL` is unset).
- [ ] **Step 5:** Make `migrate.test.ts` run only when `TEST_DATABASE_URL` is set (use `describe.skipIf`) and call `assertTestDatabase`.
- [ ] **Step 6: Run the whole seller-hub suite** with no `TEST_DATABASE_URL`: `yarn vitest run`. Expected: all pass except the already-known `admin-client.test.ts` failure and `queues.test.ts` flake; `migrate.test.ts` reports skipped. Verify the dev database row count of `seller_hub.integration_account` is unchanged (read-only `select count(*)` before and after).
- [ ] **Step 7: Commit** `test(seller-hub): refuse to run database tests against a non-test database`.

### Task 2: Backend integration setup guard

**Files:**
- Modify: `apps/backend/integration-tests/setup.js`
- Create: `apps/backend/integration-tests/guard-test-db.js`
- Create: `apps/backend/src/utils/__tests__/guard-test-db.unit.spec.ts` (only if the helper lives under `src`; otherwise colocate a spec under `integration-tests`)

**Interfaces:**
- Produces: `assertDisposableDatabase(dbName: string): void` throws when `dbName` does not start with `medusa-` or end with `_test` (Medusa's test runner creates `medusa-<random>` databases; the guard asserts that, so a misconfigured `DATABASE_URL` pointing at the dev DB aborts).

- [ ] **Step 1: Failing unit test:** `medusa-abc123` and `store_test` pass; `storecentral`, `postgres` and `""` throw with a message that never contains the connection string.
- [ ] **Step 2:** Run the spec through the project's Jest command (`cd apps/backend && yarn test:unit -- <path>`). Expected FAIL.
- [ ] **Step 3:** Implement the guard and call it from `setup.js` with the database name taken from `process.env.DB_TEMP_NAME` or the runner's configured name (read how `medusaIntegrationTestRunner` names its database in `packages/medusa-test-utils` before choosing the hook; if the runner already guarantees a throwaway name, the guard only asserts it).
- [ ] **Step 4:** Run `yarn test:unit` and one existing http spec (`channel-stock-settings`) to prove the guard does not block normal runs. Expected PASS.
- [ ] **Step 5: Commit** `test(backend): assert integration tests use a throwaway database`.

### Task 3: Backend Redis runtime modules behind a flag

**Files:**
- Create: `apps/backend/src/config/runtime-modules.ts`
- Create: `apps/backend/src/config/__tests__/runtime-modules.unit.spec.ts`
- Modify: `apps/backend/medusa-config.ts` (spread the builder output into `modules`, add `redisUrl` to `projectConfig` when on)
- Modify: `apps/backend/.env.template` (document `BACKEND_REDIS_MODULES`)

**Interfaces:**
- Produces: `buildRuntimeModules(env: { BACKEND_REDIS_MODULES?: string; REDIS_URL?: string }): { modules: ModuleConfig[]; redisUrl?: string }`. Flag not `"true"` returns `{ modules: [] }`. Flag `"true"` without `REDIS_URL` throws `Error("BACKEND_REDIS_MODULES=true requires REDIS_URL")`. Flag `"true"` with a URL returns, in this order: `@medusajs/medusa/event-bus-redis` (options `redisUrl`), `@medusajs/medusa/workflow-engine-redis` (options `redis: { url }`), `@medusajs/medusa/locking` with providers `[{ resolve: "@medusajs/medusa/locking-redis", id: "locking-redis", is_default: true, options: { redisUrl } }]`, plus `redisUrl`.

- [ ] **Step 1: Failing tests:** flag off returns `modules: []`; flag `"false"` and unset likewise; flag on without URL throws the message above; flag on with `redis://x:6379` returns the three module entries by `resolve` value in the stated order, and the url appears in each.
- [ ] **Step 2:** Run via `cd apps/backend && yarn test:unit -- src/config`. Expected FAIL.
- [ ] **Step 3:** Implement the builder; before writing options, read the option names each of the three modules expects in `packages/modules/event-bus-redis/src`, `workflow-engine-redis/src`, `locking/src` and `packages/modules/providers/locking-redis/src` and use exactly those.
- [ ] **Step 4:** Wire into `medusa-config.ts`; run `cd apps/backend && yarn build` (type check and medusa build). Expected success. With the flag off, confirm the resolved module list equals today's (compare the builder's empty result).
- [ ] **Step 5: Commit** `feat(backend): optional Redis event bus, workflow engine and locking`.

### Task 4: Prove locking through Redis serializes concurrent channel edits

**Files:**
- Create: `apps/backend/integration-tests/http/channel-offers-redis-lock.spec.ts`

**Interfaces:**
- Consumes: Task 3 builder and the existing `update-channel-offer` workflow (lock key `channel-offers:<variant_id>`).

- [ ] **Step 1:** Write a spec that, when `REDIS_TEST_URL` is set, runs two concurrent stock edits on one variant/channel through the HTTP route and asserts the final stock equals the sequential outcome and the movement ledger has two rows; the spec is skipped (with a visible reason) when `REDIS_TEST_URL` is unset so local runs without Redis stay green.
- [ ] **Step 2:** Run it with a local Redis (`REDIS_TEST_URL=redis://localhost:6379/15`, database 15 reserved for tests) and with the flag on. Expected PASS; if the vendored modules fail to start, stop and report (this is the spec's open assumption).
- [ ] **Step 3: Commit** `test(backend): channel edits serialize through the Redis lock`.

### Task 5: Seller-hub /health

**Files:**
- Modify: `apps/seller-hub/src/webhook/server.ts` (add `GET /health` before the webhook routes)
- Create: `apps/seller-hub/src/webhook/health.ts`
- Create: `apps/seller-hub/src/webhook/health.test.ts`
- Modify: `apps/seller-hub/src/index.ts` (pass dependency probes)

**Interfaces:**
- Produces: `checkHealth(probes: { postgres: () => Promise<void>; redis: () => Promise<void> }, timeoutMs?: number): Promise<{ ok: boolean }>` (default timeout 2000 ms; any probe that rejects or exceeds the timeout makes `ok` false). `createWebhookServer` deps gain `health?: () => Promise<{ ok: boolean }>`; the route answers `200 {"status":"ok"}` or `503 {"status":"unavailable"}` and nothing else.

- [ ] **Step 1: Failing tests:** both probes resolve returns `ok: true`; postgres rejects returns `ok: false`; redis hangs past the timeout returns `ok: false` within about the timeout (use a short `timeoutMs`); server test: `GET /health` returns 200 with exactly `{"status":"ok"}`, returns 503 with exactly `{"status":"unavailable"}` when the probe fails, and neither body contains an error message; `POST /health` is not a health route.
- [ ] **Step 2:** `cd apps/seller-hub && yarn vitest run src/webhook/health.test.ts`. Expected FAIL.
- [ ] **Step 3:** Implement `checkHealth` and the route; in `index.ts` build probes with `pool.query("select 1")` and `redisConnection.ping()`.
- [ ] **Step 4:** Run the full seller-hub suite; expected same known results as Task 1. Run `yarn build` (`tsc`). Expected success.
- [ ] **Step 5: Commit** `feat(seller-hub): health endpoint for Postgres and Redis`.

### Task 6: Startup configuration check

**Files:**
- Create: `deploy/check-env.mjs`
- Create: `deploy/check-env.test.mjs`
- Create: `deploy/required-env.json`

**Interfaces:**
- Produces: `checkEnv(service: "backend" | "seller-hub" | "storefront" | "pos", env: Record<string, string | undefined>, opts?: { production: boolean }): { ok: boolean; problems: string[] }`. `problems` entries are `"<NAME>: missing"`, `"<NAME>: shorter than 32 characters"` (only for names listed as secrets in `required-env.json`) or `"<NAME>: placeholder value"` (value, case-insensitively, contains `change-me`, `changeme`, `supersecret` or `your-`). Entries never contain a value. CLI: `node deploy/check-env.mjs <service>` prints one problem per line (names only) and exits 1 on any problem when `NODE_ENV=production`, otherwise prints warnings and exits 0.

- [ ] **Step 1: Failing tests** (`node --test deploy/check-env.test.mjs`): missing required name reported; 31-character secret reported; 32-character passes; `change-me-please-long-enough-xxxxxxxx` reported as placeholder; no problem string contains any test value; non-production run exits 0 with warnings; production exits 1.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement. `required-env.json` lists per service the required names and which are secrets, taken from `apps/backend/.env.template`, `apps/seller-hub/.env.example`, `apps/storefront/.env.template` (backend secrets: `JWT_SECRET`, `COOKIE_SECRET`, `AUTH_MFA_ENCRYPTION_KEY`, `SELLER_HUB_INTERNAL_SECRET`; seller-hub secrets: `ENCRYPTION_KEY`, `SELLER_HUB_INTERNAL_SECRET`, `MEDUSA_ADMIN_PASSWORD`).
- [ ] **Step 4:** Run tests; expected PASS.
- [ ] **Step 5: Commit** `feat(deploy): startup check for required and weak secrets`.

### Task 7: Dockerfiles, compose and Caddy

**Files:**
- Create: `.dockerignore`, `deploy/backend.Dockerfile`, `deploy/seller-hub.Dockerfile`, `deploy/storefront.Dockerfile`, `deploy/pos.Dockerfile`
- Create: `deploy/docker-compose.yml`, `deploy/Caddyfile`, `deploy/.env.example`, `deploy/postgres/init.sql`
- Modify: `apps/storefront/next.config.js` (add `output: "standalone"`)

**Interfaces:**
- Consumes: Task 3 flag, Task 5 `/health`, Task 6 `check-env.mjs`.
- Produces: compose services `postgres`, `redis`, `migrate`, `backend`, `seller-hub`, `storefront`, `pos`, `caddy`; internal network `internal`; only `caddy` has `ports`. Backend env includes `BACKEND_REDIS_MODULES=true`. Each Node service entrypoint runs `node deploy/check-env.mjs <service>` then its start command. `init.sql` creates roles `medusa` and `seller_hub` and schema `seller_hub` owned by `seller_hub` (passwords from environment via `psql -v`, not literals).

- [ ] **Step 1: Write `.dockerignore`** excluding `**/.env`, `**/.env.*` (except `*.template`, `*.example`), `.git`, `node_modules`, `.worktrees`, `.superpowers`, `.turbo`, `.yarn/cache`, `apps/backend/.medusa`, `.next`, `dist`.
- [ ] **Step 2: Backend image:** multi-stage on `node:22-bookworm-slim`; stage 1 enables corepack with Yarn 3.2.1, installs, builds the dashboard (`packages/admin/dashboard`) then `cd apps/backend && yarn build`; runtime copies `apps/backend/.medusa/server`, installs production deps there, runs as user `node`, `EXPOSE 9000`, `HEALTHCHECK` on `/health`, `CMD` runs `check-env` then `medusa start`.
- [ ] **Step 3: Seller-hub, storefront (standalone output), POS images** following the same pattern (ports 7005, 8000, 8001; non-root; healthcheck `GET /health` for seller-hub and `GET /` for the others using `wget -q --spider`).
- [ ] **Step 4: Compose and Caddy** as in the Interfaces block; use `depends_on` with `condition: service_healthy` (postgres, redis, migrate `service_completed_successfully`, backend, seller-hub); `mem_limit` values are placeholders `1g` marked `# set by Task 9`; Caddy routes `${STORE_HOST}` to storefront, `${ADMIN_HOST}` to backend, `${POS_HOST}` to pos, and `${ADMIN_HOST}/webhooks/*` is NOT proxied; seller-hub webhooks use `${HUB_HOST}` with `/webhooks/*` only (everything else on that host returns 404 so `/internal/*` stays private).
- [ ] **Step 5: Validate without starting anything:** `docker compose -f deploy/docker-compose.yml --env-file deploy/.env.example config` parses; a script assertion (`node --test deploy/compose.test.mjs`) reads the parsed config (`docker compose config --format json`) and asserts only `caddy` publishes ports, no service has a literal secret value, and `/internal` is not routed in the Caddyfile (string check).
- [ ] **Step 6: Build images:** `docker build -f deploy/<name>.Dockerfile .` for all four. Expected success. Run `docker run --rm <backend-image> sh -c 'ls -a /app | grep -c "^\.env$"'` equals 0 (no `.env` baked in). If Docker is unavailable on this machine, record that and rely on the CI `images` job (Task 8); do not skip the compose parse test.
- [ ] **Step 7: Commit** `feat(deploy): Dockerfiles, compose stack and Caddy`.

### Task 8: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `deploy/ci-known-failures.md`

**Interfaces:**
- Consumes: scripts from Tasks 1-7.

- [ ] **Step 1:** Write the workflow: triggers `pull_request` and `push` to `main`; Node 22; `corepack enable`; Yarn cache keyed on `yarn.lock`; jobs `lint` (backend `yarn lint`, storefront `yarn lint`), `backend-unit`, `backend-integration` (Postgres 15 and Redis service containers; env `DB_HOST`, `DB_USERNAME`, `DB_PASSWORD`, `REDIS_TEST_URL`; runs modules and http suites), `seller-hub` (`yarn build`, `yarn vitest run --exclude src/medusa/admin-client.test.ts` with `TEST_DATABASE_URL` pointing at a service database named `hub_test`), `images` (builds the four Dockerfiles, no push), `deploy-config` (`node --test deploy/*.test.mjs`).
- [ ] **Step 2:** `deploy/ci-known-failures.md` lists the excluded test, why, and "remove in Phase 2".
- [ ] **Step 3: Validate offline:** `npx --yes @action-validator/cli .github/workflows/ci.yml` or, if unavailable, a YAML parse check (`node -e` with the `yaml` package already in the repo's node_modules) plus a test that every `run:` command's workspace directory exists.
- [ ] **Step 4: Commit** `ci: lint, tests and image builds on every pull request`.

### Task 9: Memory measurement and limits

**Files:**
- Create: `deploy/measure-memory.sh`, `deploy/measure-memory.ps1`
- Create: `docs/ops/memory.md`
- Modify: `deploy/docker-compose.yml` (replace placeholder limits)

**Interfaces:**
- Produces: scripts that, for each of `backend`, `seller-hub`, `storefront`, `pos`, print `name, rss_mb_after_boot, rss_mb_after_smoke` read from `docker stats --no-stream` (compose stack) or, with `--local`, from the OS process list for the listening ports 9000, 7005, 8000, 8001. Read-only; never stops or starts anything.

- [ ] **Step 1:** Implement both scripts; run `--local` against the currently running dev servers (read-only) and record the table in `docs/ops/memory.md` labelled "dev mode, Vite and Turbopack included, not production".
- [ ] **Step 2:** If Docker is available, also run against the compose stack after Task 7 and record production-mode numbers; otherwise mark the production column "pending first compose run".
- [ ] **Step 3:** Set `mem_limit` to measured peak plus 25 percent (rounded up to 64 MB) and `NODE_OPTIONS=--max-old-space-size` to 75 percent of the limit; where production numbers are pending, keep the documented default and say so in the compose comment.
- [ ] **Step 4:** Add the laptop advice section (run only the apps you need; build the dashboard once).
- [ ] **Step 5: Commit** `docs(ops): measure service memory and set container limits`.

### Task 10: Secrets inventory, database roles, runbook and backup scripts

**Files:**
- Create: `docs/ops/secrets.md`, `docs/ops/runbook.md`
- Create: `deploy/backup.sh`, `deploy/restore.sh`, `deploy/backup.test.sh`

**Interfaces:**
- Produces: `deploy/backup.sh <output-dir>` runs `pg_dump --format=custom` for the compose database into `<output-dir>/storecentral-<UTC timestamp>.dump` and prints the path; `deploy/restore.sh <dump> <target-database>` refuses any target database whose name does not end in `_restore` or `_test`, creates it and runs `pg_restore`. Neither prints connection strings.

- [ ] **Step 1: `secrets.md`:** one table row per secret: `JWT_SECRET`, `COOKIE_SECRET`, `AUTH_MFA_ENCRYPTION_KEY`, `ENCRYPTION_KEY` (rotation makes stored marketplace credentials unreadable: document re-entering credentials), `SELLER_HUB_INTERNAL_SECRET` (must match in backend and seller-hub), `EASYPOST_API_KEY`, `EASYPOST_WEBHOOK_SECRET`, Postgres role passwords, Redis password, Stripe key, AWS keys. Each: owner service, how to generate (`openssl rand -hex 32`), what breaks on rotation.
- [ ] **Step 2: Scripts** as in Interfaces. `backup.test.sh` runs against a disposable Postgres container: create `x_test`, insert a row, back up, restore into `x_restore`, assert the row exists, and assert restore into `storecentral` is refused.
- [ ] **Step 3: `runbook.md`:** first deploy (fill `deploy/.env`, `docker compose up -d`, create the first admin user), update procedure (pull, build, `migrate`, restart order backend then seller-hub then storefront), rollback (previous image tag plus restore), reading health (`/health` per service), what to do on each failing health check, and a quarterly restore drill.
- [ ] **Step 4:** Run `backup.test.sh` if Docker is available; otherwise run `shellcheck` if present and record that the drill is pending.
- [ ] **Step 5: Commit** `docs(ops): secrets inventory, runbook and backup scripts`.

### Task 11: Whole-phase verification

**Files:** none (verification only; findings go to the ledger).

- [ ] **Step 1:** Backend: `cd apps/backend && yarn build && yarn test:unit` and the http spec set touched by Tasks 2-4. Seller-hub: `yarn build && yarn vitest run`. Expected: only the known failures from `deploy/ci-known-failures.md`.
- [ ] **Step 2:** `node --test deploy/*.test.mjs` passes; compose config parses.
- [ ] **Step 3:** Confirm `git diff master --stat` touches nothing under `packages/` and no `.env*` file; run `git grep -n -E "(JWT|COOKIE)_SECRET=[^<$ ]" -- deploy docs .github` and expect no match.
- [ ] **Step 4:** Dry read of the runbook against the compose file (names, ports, hosts consistent).
- [ ] **Step 5:** Report which items could not be exercised on this machine (Docker, Redis) and are covered only by CI or the first real deployment.
