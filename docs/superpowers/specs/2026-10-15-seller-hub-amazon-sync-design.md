# Seller Hub — Amazon Sync Engine (Sub-Project 1)

## Context

This is the first of several sub-projects toward a broader "Seller Hub"
vision: a centralized, omnichannel seller management platform connecting
Amazon, eBay, Walmart, this project's own storefront, and its POS through
one Medusa backend (see the user-provided architecture diagram and SRS
that originated this design). That full vision spans ~16 functional
modules across 3 marketplaces and 2 shipping providers — too large for a
single spec, so it's being decomposed. This document covers only the
first slice.

**What's already built** (prior work in this repo): the Medusa backend,
Next.js storefront, and a web POS app, all running locally against a
single US/USD region, with Point of Sale / Mobile App sales channels
already set up. This spec does not change any of that.

**What this sub-project delivers:** the sync-engine scaffolding
(background jobs, retries, idempotency, reconciliation) built out against
exactly one marketplace — Amazon — proven end-to-end for product,
inventory, price, and order sync. Every other marketplace and the
dashboard UI are deliberately out of scope here; the goal is to validate
the pattern once before replicating it.

## Decisions carried into this design

These were confirmed with the user before design work started:

- **First marketplace: Amazon (SP-API).** Hardest onboarding of the three
  (app-approval process, professional seller account required) but
  highest long-term value; proving the pattern against the hardest case
  first de-risks the easier ones later.
- **Single-tenant, personal use.** The user manages their own connected
  stores. No multi-tenant data isolation, per-tenant billing, or
  cross-org permissions in this design — deliberately deferred (YAGNI).
  If this later becomes a multi-seller SaaS product, tenant boundaries
  need to be designed in *before* customer accounts are added, not
  retrofitted.
- **Deployment target: undecided, develop locally first.** The user
  wants to build and run this locally, then decide hosting afterward.
  Architecture therefore avoids platform-specific primitives (e.g.
  Cloudflare Queues, Durable Objects) in favor of portable, standard
  building blocks (Node.js, Postgres, Redis) that work identically
  locally and on a conventional host, and can be ported later.
- **Dashboard UI deferred.** This sub-project is verified via API
  calls, logs, and Medusa's existing admin — not a built UI. The SRS's
  "Module A — Central dashboard" becomes its own later sub-project.

## Goals

- Prove the sync-engine architecture end-to-end against one real
  marketplace (Amazon) for all four sync concerns: product, inventory,
  price, and order.
- Establish patterns (idempotency, retry/backoff, dead-letter, source-
  of-truth-per-field, reconciliation) that later marketplace integrations
  (eBay, Walmart) and the shipping integrations (EasyPost, ShippingEasy)
  can replicate rather than re-invent.
- Touch Medusa's existing backend as little as possible: reuse its
  existing Admin API and the standard subscriber extension point only —
  no changes to `packages/` core source, no new Medusa core modules.

## Non-goals (explicitly out of scope for this sub-project)

- eBay and Walmart integrations (future sub-projects, same pattern).
- EasyPost / ShippingEasy shipping integration (future sub-project).
- Marketplace message center (SRS Module G).
- Any dashboard/admin UI for Seller Hub.
- Multi-tenant / SaaS support.
- Final hosting/deployment decision (Cloudflare vs. VPS vs. other).

## Architecture

A new, fully separate service — **Seller Hub** — is added alongside the
existing Medusa backend. Medusa itself is not modified except for one
small subscriber file (a standard, intended Medusa extension point, not
a core change).

```
                         ┌─────────────────────────┐
                         │   Amazon SP-API          │
                         │  (Orders, Listings,      │
                         │   Pricing, Notifications) │
                         └───────────┬──────────────┘
                     SQS notifications │  REST calls (LWA auth)
                                       ▼
┌───────────────────────────────────────────────────────────┐
│  apps/seller-hub  (new, standalone Node/TypeScript service) │
│                                                               │
│  ┌──────────────┐   ┌───────────────┐   ┌─────────────────┐ │
│  │ SQS consumer │──▶│  BullMQ queues │──▶│  SP-API client   │ │
│  │   worker     │   │ (per concern,  │   │ (LWA auth, rate- │ │
│  └──────────────┘   │  retry/DLQ)    │   │  limited wrapper)│ │
│         ▲            └───────┬───────┘   └────────┬─────────┘ │
│         │                    │                     │           │
│         │   ┌────────────────▼─────────────────┐   │           │
│         │   │ SyncJob / ChannelListing /        │   │           │
│         │   │ IntegrationAccount (own schema,   │   │           │
│         │   │ same Postgres instance as Medusa) │   │           │
│         │   └───────────────────────────────────┘   │           │
│         │                                            │           │
│  ┌──────┴───────┐                                    │           │
│  │ Webhook       │◀───────────────────────────────────┘          │
│  │ receiver      │   Medusa Admin API (products, inventory,      │
│  │ (from Medusa  │   prices, draft-orders)                       │
│  │  subscriber)  │──────────────────────────────┐                │
│  └───────────────┘                               │                │
└───────────────────────────────────────────────────┼────────────────┘
                                                      ▼
                                   ┌───────────────────────────────┐
                                   │  Medusa backend (existing,     │
                                   │  apps/backend — unmodified     │
                                   │  except one subscriber file)   │
                                   └───────────────────────────────┘
```

### Components

- **`apps/seller-hub`** — new workspace in this Turbo monorepo. Standalone
  Node/TypeScript service; its own process, its own `package.json`.
- **Database** — own schema in the same Postgres instance Medusa already
  uses. Tables: `integration_account`, `channel_listing`, `sync_job`
  (see Data Model below). No changes to Medusa's own tables/schema.
- **Job queue** — BullMQ on the existing local Redis (Memurai). Separate
  queues per concern: `product-sync`, `inventory-sync`, `price-sync`,
  `order-sync`. Each queue: exponential backoff, capped retry attempts,
  failed jobs flagged in `sync_job` rather than silently dropped.
  Repeatable (cron-style) jobs handle scheduled reconciliation.
- **SP-API client module** — wraps Amazon's LWA OAuth (refresh-token flow
  per `integration_account`, encrypted token storage; grantless tokens for
  app-level operations like managing notification subscriptions) and
  applies a per-operation token-bucket rate limiter, since SP-API limits
  are per-operation, not global. Handles `429`/`Retry-After` by backing
  off rather than retrying immediately.
- **SQS consumer worker** — Amazon's Notifications API delivers events
  (e.g. `ORDER_CHANGE`) to an SQS queue owned by this project. The worker
  polls that queue and enqueues normalized BullMQ jobs. **This requires
  an AWS account and an SQS queue** — a genuine new infrastructure
  dependency, not avoidable given how SP-API delivers events.
- **Webhook receiver** — a small HTTP endpoint Seller Hub exposes, called
  by the new Medusa subscriber (see below) when inventory or price data
  changes in Medusa, so Seller Hub doesn't have to poll Medusa as its
  primary signal.
- **Medusa subscriber** (`apps/backend/src/subscribers/`, one new file) —
  listens for Medusa's own inventory-level/price-change events and POSTs
  to Seller Hub's webhook receiver. This is the one touch-point in
  Medusa's codebase; it's the project's standard, intended extension
  mechanism (not a core/`packages/` change).

### Why a separate service (not new Medusa modules)

Considered and rejected: building this as Medusa modules/workflows
inside the existing backend. Rejected because (a) it goes against this
project's modularity preference ("avoid modifying Medusa core
unnecessarily" — a new module is additive but still couples the sync
engine's uptime and deployability to Medusa's own process), and (b)
Medusa's workflow engine isn't built for long-running queue-consumer
workloads like SQS polling and scheduled reconciliation; a dedicated
worker process fits that job better. A separate service also means an
Amazon outage or a bug in the sync engine cannot take down Medusa, the
storefront, or POS.

## Data model

New tables, owned by Seller Hub, in the same Postgres instance as Medusa:

| Table | Purpose |
|---|---|
| `integration_account` | One row per connected marketplace account (here: one Amazon account). Holds encrypted LWA refresh token, connection status, last successful sync timestamp. |
| `channel_listing` | Maps a Medusa product/variant to its Amazon listing (ASIN/SKU, listing status: draft/pending/published/rejected/error, last sync result). |
| `sync_job` | One row per sync attempt (product/inventory/price/order), keyed by `(integration_account_id, external_id)` for idempotency. Tracks status, attempt count, last error, and links to the Medusa entity (order ID, product ID) it produced or updated. |

Medusa's own order `metadata` field is used to tag marketplace-origin
orders (`metadata.amazon_order_id`), so idempotency can also be checked
directly against Medusa's order data via its Admin API, not only via
`sync_job`.

## Data flow

### Order import (Amazon → Medusa)

1. SQS delivers an `ORDER_CHANGE` notification.
2. Worker fetches the full order via SP-API's Orders API.
3. Idempotency check: does a `sync_job` (or a Medusa order with matching
   `metadata.amazon_order_id`) already exist for this Amazon order ID? If
   yes, stop (already processed).
4. Map Amazon SKUs to Medusa variant IDs via `channel_listing`.
5. `POST /admin/draft-orders` on Medusa's existing Admin API — sales
   channel set to a dedicated "Amazon" sales channel (created the same
   way the Point of Sale / Mobile App channels were earlier in this
   project), line items from the mapped variants, `metadata.amazon_order_id`
   set.
6. `POST /admin/draft-orders/:id/convert-to-order` — converts the draft
   into a real, standard Medusa order.
7. Record success in `sync_job`, linking the Medusa order ID.

No Medusa core changes or core-flows access required — both calls are
existing, documented Admin API routes.

### Inventory & price sync (Medusa → Amazon)

1. Primary trigger: the new Medusa subscriber fires on an inventory-level
   or price change and POSTs to Seller Hub's webhook receiver.
2. Fallback trigger: scheduled reconciliation (a repeatable BullMQ job)
   periodically compares Medusa's current state against what Seller Hub
   last pushed, catching anything the subscriber missed (process
   restarts, delivery failures, etc.) — same "webhooks first, 
   reconciliation backstops it" principle as the Amazon→Medusa direction.
3. Either trigger enqueues a job that reads current Medusa state via the
   Admin API, applies any channel-specific price rule (e.g. a percentage
   markup to cover Amazon fees, stored on `channel_listing`), and pushes
   the update via SP-API's Listings/Pricing feed APIs.
4. `channel_listing` and `sync_job` updated with the result.

**Source of truth:** Medusa is authoritative for inventory and price —
this direction is push-only to Amazon. Seller Hub never writes inventory
or price back into Medusa from Amazon.

### Product sync (Medusa → Amazon)

1. Triggered by a `product.created`/`product.updated` subscriber event,
   or a manual "list on Amazon" trigger (CLI/API call, since there's no
   dashboard yet).
2. Seller Hub creates/updates the corresponding `channel_listing` row
   (status starts `draft`).
3. Submits via SP-API's Listings feed; polls feed-processing result.
4. Updates `channel_listing.status` to `pending` → `published`, or
   `rejected`/`error` with the reason recorded.

## Error handling

- **Idempotency key:** `(integration_account_id, external_id)` on every
  `sync_job` row — covers duplicate SQS deliveries and repeated
  reconciliation sweeps without double-importing orders or double-pushing
  listings.
- **Retries:** BullMQ exponential backoff with jitter, capped attempts.
  Transient errors (`429`, `5xx`) retry; permanent errors (`4xx`
  validation failures) fail immediately into a "needs attention" state
  instead of burning through retries.
- **Dead-letter:** after max attempts, `sync_job.status = 'failed'` — 
  queryable and retriable later (via a direct DB/API query, since there's
  no dashboard yet), never silently dropped.
- **Rate limiting:** the SP-API client enforces a per-operation
  token-bucket limiter matching Amazon's own model, and honors `429` /
  `Retry-After` rather than retrying immediately.
- **Source of truth per field:** Medusa owns inventory/price (push-only
  to Amazon); Amazon owns its own order status (pull-only into Medusa).
  Seller Hub never pushes order-status changes back to Amazon except
  fulfillment/tracking info, once the shipping sub-project exists.
- **Blast radius:** Seller Hub is a fully separate process from Medusa —
  an Amazon outage or a bug in the sync engine cannot take down the
  backend, storefront, or POS.

## Testing strategy

- **Unit:** SP-API client wrapper against mocked HTTP responses
  (including `429`/`5xx` paths); job-handler logic as pure functions
  where feasible.
- **Integration:** Seller Hub's own DB + BullMQ behavior against the
  real local Postgres/Redis already running in this environment — no
  live Amazon calls.
- **Replay tests:** once SP-API sandbox credentials exist, record
  sanitized real notification/order payloads and replay them through the
  SQS-consumer → job pipeline in automated tests, so core logic is
  verified without hitting Amazon in CI.
- **Manual smoke checklist:** before this sub-project is considered
  done, an end-to-end pass against Amazon's actual sandbox/test seller
  account for all four flows (order import, inventory push, price push,
  product listing). This is also where exact SP-API sandbox mechanics
  get confirmed against current docs rather than assumed in advance.

## Open items carried into implementation planning

- Exact Medusa event names for the inventory/price subscriber (e.g.
  `inventory-level.updated`) need confirming against the current Medusa
  version in this repo before the subscriber is written.
- Exact SP-API rate limits per operation (orders, listings, pricing)
  need confirming against Amazon's current published rate tables — the
  values floating around online are not all verifiable against official
  docs and should not be hardcoded without checking.
- AWS account / SQS queue provisioning is a prerequisite the user needs
  to set up (or grant access to) before the order-import flow can be
  built and tested.
- Amazon SP-API app registration / professional seller account approval
  is a prerequisite with its own external timeline, outside this
  project's control — worth starting early since it can be the longest
  lead time item.

## Acceptance criteria for this sub-project

- A product can be listed on Amazon from Medusa and reach `published`
  status in `channel_listing`.
- An inventory or price change in Medusa propagates to Amazon, and a
  failed propagation is visible (queryable) rather than silent.
- A real (sandbox) Amazon order is imported into Medusa as a real Order
  exactly once, even if the SQS notification is delivered more than
  once.
- Amazon API rate limits are respected — no sustained `429`s during
  normal operation.
- A failed sync job can be identified and retried.
- None of the above can crash or degrade the existing Medusa backend,
  storefront, or POS.
