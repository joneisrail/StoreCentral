# Phase 4d: Amazon and AWS settings in the admin

Date: 2026-11-24. Status: draft for owner review. Parent: Phase 4 "channel completeness" (see `2026-11-23-phase-4a-channel-product-import-design.md`). This is the first step of 4d (Amazon go-live): moving the account-level Amazon and AWS values out of server files and into an admin settings page. Per-channel Amazon push stays a later step.

## Intent (assumptions, please correct)

- Who: the store owner, who has just created (or is about to create) the AWS account, the SQS queue and the Amazon SP-API application.
- Problem: today these values are environment variables (`AWS_REGION`, `SQS_QUEUE_URL`, `AMAZON_LWA_CLIENT_ID`, `AMAZON_LWA_CLIENT_SECRET`, plus the AWS access keys read by the AWS SDK). Changing one means editing `deploy/.env` on the server and recreating the container. All four non-key variables are required, so seller-hub refuses to start without them. Until real keys exist the SQS poll logs `CredentialsProviderError` every second.
- Success: the owner opens Settings, then Amazon, enters the six values, presses "Test connection", then Save. The running seller-hub starts polling the queue with those values, no file edit and no restart. Secrets are stored encrypted and are never shown again.
- Decided with the owner: the page holds all six values (region, queue URL, AWS access key id, AWS secret access key, LWA client id, LWA client secret). The per-seller Amazon refresh token stays on the Amazon connection form (it already follows the Shopify/WooCommerce pattern).

## Current behaviour (read from code)

- `apps/seller-hub/src/env.ts` `loadEnv()` throws if any of the four Amazon variables is missing. `index.ts` builds one `SQSClient({ region })`, one `SqsConsumer`, and one `SpApiClient({ clientId, clientSecret, refreshToken })` at boot and never rebuilds them.
- AWS keys are not read by seller-hub code: the SDK finds `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in the environment, or an instance role.
- `deploy/docker-compose.yml`, `deploy/required-env.json`, `deploy/check-env.test.mjs` and `docs/ops/secrets.md` list the four variables as required for seller-hub; the two AWS keys are optional.
- Connection credentials (Shopify, WooCommerce, Amazon refresh token) are already stored encrypted in `seller_hub.integration_account` using `crypto/secret-box.ts` and `ENCRYPTION_KEY`, edited through `/internal/connections` and the backend proxy `/admin/marketplace-connections`. The never-return-secrets and blank-means-keep rules (`pick()` in `connectors/credentials.ts`) already exist and are reused.

## Design

### Storage (seller-hub)

New table `seller_hub.amazon_settings`, added to `SCHEMA_SQL` (idempotent `CREATE TABLE IF NOT EXISTS`, no data migration). One row only, enforced by `id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id)`.

| Column | Kind |
|---|---|
| `aws_region`, `sqs_queue_url`, `lwa_client_id` | plain text, nullable |
| `aws_access_key_id_encrypted`, `aws_secret_access_key_encrypted`, `lwa_client_secret_encrypted` | encrypted text, nullable (`secret-box`) |
| `updated_at` | timestamptz |

Region, queue URL and LWA client id are identifiers, not secrets; the access key id is stored encrypted anyway because it identifies an IAM user.

### Resolving the values

New module `apps/seller-hub/src/settings/amazon-settings.ts`:

- `resolveAmazonSettings(pool, encryptionKey, env)` returns, per field, `{ value, source: "database" | "environment" | "none" }`. A stored value wins over the environment variable; the environment is the fallback, so existing deployments keep working unchanged.
- The AWS access key pair is one unit: both from the database, or both from the environment/default chain. A half-stored pair is rejected on save.
- `saveAmazonSettings`, `clearAmazonSettings` (deletes the row; every field falls back to the environment).
- Validation on save: region matches `^[a-z]{2}(-[a-z]+)+-\d$`; queue URL starts with `https://` and has a host ending `amazonaws.com` (or `amazonaws.com.cn`); LWA client id starts with `amzn1.application-oa2-client.`; blank means "keep the stored value". Violations are a `kind: "invalid"` error that names the field and never the value.

### Applying changes without a restart

`index.ts` stops building the SQS consumer and Amazon API client inline. A small `AmazonRuntime` object owns them:

- `apply()` resolves the settings; if region and queue URL are both present it creates (or replaces) the `SQSClient` and `SqsConsumer` and starts polling, otherwise it stops any running consumer and logs one line ("Amazon notifications not configured"). The old consumer is stopped before the new one starts, so there is never more than one poller.
- AWS keys, when stored or set in the environment, are passed to `SQSClient` as explicit `credentials`; when neither exists the SDK default chain (instance role) is used.
- `SpApiClient` reads the LWA client id and secret through a provider function instead of fixed constructor values, so a saved change applies to the next token refresh. The existing refresh-token cache is discarded when the client id or secret changes.
- `apply()` runs once at boot and again after every successful save or clear.
- The four env variables become optional in `loadEnv()`; a missing one is `undefined`, not a crash. Because `AWS_*` is no longer a boot requirement, the `CredentialsProviderError` log noise ends when nothing is configured.

### Seller-hub internal API

Behind the existing shared-secret check, same style as `/internal/connections`:

- `GET /internal/amazon-settings` returns `{ aws_region, sqs_queue_url, lwa_client_id }` as `{ value, source }`, plus `{ aws_access_key_id_set, aws_secret_access_key_set, lwa_client_secret_set }` as `{ set: boolean, source }`, plus `consumer_running: boolean`. No secret value, and no partial value such as a last-four suffix, ever leaves seller-hub.
- `POST /internal/amazon-settings` with any subset of the six fields. Blank or absent means keep. Saves, then calls `apply()`, and returns the same body as `GET`.
- `DELETE /internal/amazon-settings` clears stored settings, then `apply()`.
- `POST /internal/amazon-settings/test` resolves the current effective settings, or the supplied unsaved values overlaid on them, and calls SQS `GetQueueAttributes` (`ApproximateNumberOfMessages`) against the queue with a 10 second timeout. Returns `{ ok: true }` or `{ ok: false, code, message }` where `code` is one of `not_configured`, `invalid_credentials`, `queue_not_found`, `access_denied`, `unreachable`. Messages come from a fixed table, not from the AWS error text, so nothing sensitive can leak. It validates the SQS side only: the LWA id/secret cannot be checked without a seller's refresh token, so the page says so.
- Every error body that could echo input goes through `sanitizeSyncError`; request bodies are never logged.

### Backend proxy

`/admin/amazon-settings` (GET, POST, DELETE) and `/admin/amazon-settings/test` (POST), built exactly like `marketplace-connections` (`respond`, `callSellerHub`), with a Zod schema for the body (Medusa's `@medusajs/framework/zod`) that limits each field to a string of at most 2048 characters. Admin authentication is the existing Medusa admin middleware; nothing is exposed under `/store`. Seller-hub down surfaces as the existing 502 `seller_hub_unavailable`.

### Admin UI

A new settings page in the forked dashboard, route `/settings/amazon`, entry "Amazon" in the settings sidebar next to "Sales channels" (`settings-layout.tsx`, route map, `en.json` and `$schema.json`).

- A form with six fields. Region, queue URL and LWA client id show their current value. The three secrets render as a masked field showing "Set" (placeholder "Leave blank to keep"), never the value.
- Each field has a small source badge: "Saved here", "From server environment", "Not set".
- Buttons: "Test connection" (sends the form's unsaved values, shows the result and the fixed message), "Save" (disabled until something changed), "Clear stored settings" behind a confirmation prompt (explains that values fall back to the server environment).
- A status line: "Notifications running" / "Not running (configure above)".
- A load error or a seller-hub-down 502 shows a banner with the message and no stale values. All text goes through `t()`.

### Security

- Secrets are encrypted at rest with `ENCRYPTION_KEY`, never returned, never logged, never in error text. Rotating `ENCRYPTION_KEY` makes stored ciphertext undecryptable, so resolution treats a decrypt failure as "not set" for that field and logs the field name only (as the connection loader does).
- Only authenticated admin users reach the backend routes. The internal routes need the shared secret.
- `docs/ops/secrets.md` and the runbook say: IAM user with least privilege on the one queue (`sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes`), rotate by saving a new value on the page.

### Deploy config and docs

- `deploy/docker-compose.yml`: the four variables move to optional (`${VAR:-}`), `required-env.json` and `check-env.test.mjs` drop them from the required list, `deploy/.env.example` marks them "optional, normally set on the Settings, Amazon page".
- Runbook: a new "Amazon settings" section (what to enter, test button, status line, rollback by clearing). `apps/seller-hub/README.md` env table and `docs/ops/secrets.md` rows updated. The stale `SQS_QUEUE_URL` placeholder notes are replaced.

### Rulings (recommended choices, taken)

- Database wins over environment, per field, so nothing breaks for current deployments.
- The AWS key pair is all-or-nothing.
- Test connection checks SQS only; LWA cannot be verified without a seller refresh token.
- Test errors come from a fixed message table (no AWS text) so no sensitive value can be echoed.
- One settings row (account-level), not per connection: there is one AWS queue and one SP-API application for the whole store.
- The page does not manage the queue's subscription to Amazon `ORDER_CHANGE` notifications; that setup stays an owner/AWS step described in the runbook.

## Testing

- Store: save, blank-keeps, clear, singleton, half key pair rejected, validation of each field, encryption (stored column is not the plaintext), env fallback, decrypt failure treated as not set. Guarded test DB (`hub_test`).
- Internal routes: 401 without secret, 405 wrong method, GET never contains a secret (assert on the serialized body), POST triggers `apply()`, DELETE, test action mapping each error code with a fake SQS client.
- `AmazonRuntime`: starts when configured, stops when cleared, replaces rather than doubles consumers, explicit credentials passed only when present, LWA provider reflects a saved change. No live AWS or Amazon calls anywhere.
- `loadEnv`: boots with all four variables absent.
- Backend: proxy path, method, body validation (oversized, unknown field), 502 passthrough.
- Dashboard: form renders sources and "Set" for secrets, never a secret value; save sends only changed fields; test shows each result; clear confirmation; error banner shows no stale values; nav entry and route.
- Deploy: `node --test deploy/*.test.mjs` updated for the optional variables.

## Not in this spec

Per-channel Amazon push and listing sync, managing the Amazon seller refresh token or the OAuth flow, creating the AWS queue or IAM user, a general-purpose settings store for other integrations, audit history of setting changes, per-environment settings.
