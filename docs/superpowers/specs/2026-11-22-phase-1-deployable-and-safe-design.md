# Phase 1: deployable and safe

Follows `docs/phase-0/` (architecture and audit). Addresses risks R1, R2, R4, R6, R8.

## Purpose and decisions

Make StoreCentral runnable the same way on any machine and safe to run with more than one process, without changing any business behaviour.

**Intended outcome:** on a fresh Linux server with Docker, one command starts Postgres, Redis, backend, seller-hub, storefront and POS from documented environment values; every service reports health; a push to GitHub runs lint and tests; tests can never touch the dev or production database.

Owner decisions (from the Phase 0 questions, "take all recommended"):

| Question | Decision |
|---|---|
| Medusa fork | Keep as is for Phase 1. The keep-or-migrate decision stays Phase 3. Phase 1 changes nothing inside `packages/**`. |
| Production target | A single Linux server with Docker Compose (Caddy for TLS). Kubernetes and PaaS are out of scope. |
| Order | Deployability first (this phase), channel features later. |
| Test rows in dev DB | Stop the cause (guard), but do NOT delete existing rows: the standing rule is to keep test data. Cleanup stays an owner decision. |

## Out of scope

Kubernetes, cloud-provider specifics, the fork decision, fixing the known failing tests (Phase 2), new product features, any change to marketplace behaviour, deleting data.

## Design

### 1. Backend runtime modules (R2)

`medusa-config.ts` gains Redis-backed modules, switched by one flag so a developer laptop is unchanged:

- When `BACKEND_REDIS_MODULES=true` and `REDIS_URL` is set: event bus `@medusajs/medusa/event-bus-redis`, workflow engine `@medusajs/medusa/workflow-engine-redis`, locking `@medusajs/medusa/locking` with the `locking-redis` provider (default provider), and `projectConfig.redisUrl`.
- Otherwise (default in dev): today's in-memory behaviour, no change.
- Compose sets the flag to `true`. A unit test covers the config builder (flag on / off / flag on without URL fails fast with a clear message).
- The existing per-variant lock names (`channel-offers:<variant_id>`) work unchanged with the Redis provider; one integration check proves two concurrent edits serialize through it.

### 2. Container images and process model (R1)

Files under `deploy/` (new) plus a `.dockerignore`:

- `deploy/backend.Dockerfile`: multi-stage; builds the dashboard and `medusa build`; runtime runs `medusa start` on port 9000 as a non-root user.
- `deploy/seller-hub.Dockerfile`: `tsc` build, runs `node dist/index.js` on 7005.
- `deploy/storefront.Dockerfile`: Next.js `output: "standalone"` (adds that one option to `next.config`), port 8000.
- `deploy/pos.Dockerfile`: `node server.js`, port 8001.
- `deploy/docker-compose.yml`: services `postgres`, `redis`, `migrate` (one-shot `medusa db:migrate`, backend waits for it), `backend`, `seller-hub`, `storefront`, `pos`, `caddy`. Named volumes for Postgres and Redis. Only Caddy publishes ports 80/443; services talk on the internal network. Seller-hub's internal API is never exposed publicly.
- `deploy/Caddyfile`: hostnames from env (`STORE_HOST`, `ADMIN_HOST`, `POS_HOST`); `/webhooks/*` for seller-hub on its own host.
- `deploy/.env.example`: every variable, no values.
- Memory: each service gets `mem_limit` and `NODE_OPTIONS=--max-old-space-size=<n>`. The numbers come from a measurement task (section 6), not guesses.

### 3. Health and readiness (R1)

- Backend: use the existing `/health`.
- Seller-hub: add `GET /health` on the webhook server (public, no data): 200 only when Postgres and Redis answer within 2 s, else 503. It reveals no versions or configuration.
- Storefront and POS: a plain 200 on `/` (compose `healthcheck` with `wget`).
- Compose `depends_on: condition: service_healthy` chains Postgres, Redis, migrate, backend, seller-hub, storefront.

### 4. CI (R1)

`.github/workflows/ci.yml`, triggers: pull requests and pushes to `main`. Uses Node 22 and Yarn 3.2.1 with cache. Jobs:

1. `lint`: `yarn lint` for backend and storefront.
2. `backend-unit`: `test:unit`.
3. `backend-integration`: Postgres 15 service; `test:integration:modules` and `test:integration:http`.
4. `seller-hub`: build (`tsc`) and `vitest run`, excluding the known failing `admin-client.test.ts` (listed in a visible `CI_KNOWN_FAILURES` note; removed in Phase 2).
5. `images`: build all four Dockerfiles without pushing.

Dashboard tests are not part of Phase 1 CI (3 known failures, Phase 2). No deploy step: pushing images and deploying stays manual until you choose a registry.

### 5. Test database isolation (R4)

- Find which tests wrote the credential-less Amazon rows into the dev `seller_hub.integration_account` (plan task 1, read-only investigation; candidates: `connections.e2e.test.ts`, `migrate.test.ts`, `schema.test.ts`).
- Add a seller-hub Vitest setup file: if a test connects to a real database, `DATABASE_URL` must name a database whose name ends in `_test`, otherwise the run aborts before any query. Tests that need Postgres read `TEST_DATABASE_URL`, never `DATABASE_URL`.
- Add the same kind of guard to the backend integration setup (Medusa's test runner already creates throwaway databases; the guard only asserts it).
- Documentation of how to create the `_test` database. Existing rows are left alone.

### 6. Memory sizing (R8)

A script `deploy/measure-memory.ps1` and `.sh` (read-only) samples each service's resident memory after boot and after a smoke request set, and writes a table to `docs/ops/memory.md`. Compose limits and heap sizes are set from that table plus 25 percent headroom. The doc also gives the laptop advice: run only the apps you need; build the dashboard once instead of running Vite in dev.

### 7. Secrets and configuration (R6)

- `docs/ops/secrets.md`: one row per secret (name, owner service, purpose, how to generate, rotation effect). Covers `JWT_SECRET`, `COOKIE_SECRET`, `AUTH_MFA_ENCRYPTION_KEY`, `ENCRYPTION_KEY` (rotating it makes stored marketplace credentials unreadable; procedure given), `SELLER_HUB_INTERNAL_SECRET`, `EASYPOST_*`, database and Redis passwords, Stripe key.
- `deploy/check-env.mjs`: runs as the first step of each container. In production it fails fast when a required variable is missing, when a secret is shorter than 32 characters, or when a value equals a known placeholder (`supersecret`, `change-me...`). It prints variable names only, never values.
- Per-service database roles: `deploy/postgres/init.sql` creates a `medusa` role (schema `public`) and a `seller_hub` role (schema `seller_hub` only) for the compose database.

### 8. Operations runbook

`docs/ops/runbook.md`: first deploy, update procedure (pull, build, `migrate`, restart order), rollback, logs, a Postgres backup and restore script (`deploy/backup.sh`, `deploy/restore.sh`, with a documented restore test), and what to do when a health check fails.

## Error handling and safety

- Nothing in this phase writes to the existing dev database. The compose stack uses its own volumes.
- `docker-compose.yml` has no default secrets: missing values fail `check-env` instead of starting insecurely.
- The Redis flag defaults off, so existing developer setups behave exactly as today.

## Testing

- Unit: config builder (flag combinations), `check-env` rules (missing, short, placeholder, never prints values), seller-hub `/health` (200, 503 on each dependency failure).
- Integration: lock serialization through the Redis provider; DB guard refuses a non-`_test` database.
- Delivery check on a clean machine or CI runner: `docker compose build`, `docker compose up`, all services healthy, one request through Caddy to storefront and admin, seller-hub `/health` 200, backup then restore into a scratch database.

## Review focus

- No secret value ever appears in logs, images, compose files or CI output.
- Seller-hub internal API unreachable from outside the compose network.
- Default developer workflow (`yarn dev`, in-memory modules) unchanged.
- The test guard cannot be bypassed by an unset variable (unset means abort).
- Images run as non-root and contain no `.env` files (`.dockerignore`).

## Delivery

One branch, one plan, in this order: (1) investigation and test guards, (2) backend Redis config, (3) seller-hub health, (4) Dockerfiles and compose, (5) check-env and secrets docs, (6) CI, (7) measurement and limits, (8) runbook and backup scripts.

## Open assumptions

- The server has Docker Compose v2 and at least 4 GB RAM (to be confirmed by the measurement).
- The `locking-redis` provider and `event-bus-redis` module in `packages/modules` work with the vendored 2.21.2 core (the plan's second task proves it with a test before anything else depends on it).
- GitHub Actions is the CI host (the repo is on GitHub).
