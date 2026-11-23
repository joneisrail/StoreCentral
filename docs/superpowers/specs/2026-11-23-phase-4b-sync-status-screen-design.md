# Phase 4b: sync-status panel for a marketplace connection

Date: 2026-11-23. Status: draft for owner review. Parent: Phase 4 "channel completeness" (`docs/superpowers/specs/2026-11-23-phase-4a-channel-product-import-design.md` lists the four sub-projects).

## Intent (assumptions, please correct)

- Who: the store owner, looking at a sales channel connected to Shopify or WooCommerce (Amazon has no live sync).
- Problem: today the connection section shows a status badge, a last error, "last synced" and a count of linked listings. When a push fails, or seller-hub is down, the owner cannot see what failed, for which SKU, or since when.
- Success: from the sales channel page the owner can answer, without a database query: is seller-hub reachable, is the sync running, how many listings are linked and in what state, which syncs failed (SKU, kind, message, when), and when did each kind of sync last succeed.
- Read-only. No retry button, no editing of jobs (see "Not in this spec").

## Current data (read from code)

- `seller_hub.integration_account`: `status` (connected/disconnected/error), `last_error`, `last_synced_at`, `managed`.
- `seller_hub.channel_listing`: `status` (draft/pending/published/rejected/error), `last_error`, `last_synced_quantity`, `last_synced_price` (NULL means never pushed), per `integration_account_id`.
- `seller_hub.sync_job`: `sync_type` (product/inventory/price/order/tracking), `external_id`, `status` (pending/processing/succeeded/failed), `attempts`, `last_error`, `updated_at`, unique per account, type and external id.
- The internal API (`apps/seller-hub/src/internal/connections.ts`) already lists connections with `sync_live` (a runtime is running). The backend proxies it through `/admin/marketplace-connections` and answers 502 with `seller_hub_unavailable` when seller-hub cannot be reached.

## Design

### Seller-hub: `GET /internal/connections/:id/sync-status`

Secret protected like the other internal routes; 404 for an unknown id; works without a live runtime (it only reads the database). Returns:

```
{
  "sync_live": boolean,              // runtime running (false always for amazon)
  "connection": { "status": "...", "last_error": "...|null", "last_synced_at": "...|null" },
  "listings": { "total": n, "by_status": { "published": n, ... }, "with_error": n, "never_pushed": n },
  "jobs": {
    "by_type": { "inventory": { "pending": n, "processing": n, "failed": n, "succeeded": n }, ... },
    "last_succeeded_at": { "inventory": "...|null", "price": "...|null", "order": "...|null", "tracking": "...|null", "product": "...|null" }
  },
  "recent_failures": [ { "sync_type", "external_id", "attempts", "last_error", "updated_at" } ],   // newest first, at most 25
  "failures_total": n
}
```

- `never_pushed` counts listings whose `last_synced_quantity` is NULL (linked, not yet pushed). Imported listings carry a baseline (Phase 4a), so they are not counted there.
- `last_error` strings are passed through `sanitizeSyncError` again on the way out and cut to 300 characters. No credentials are ever selected.
- One query per block, all filtered by `integration_account_id`; no new tables, no migration. Existing indexes are enough for one account's rows; the unique key on `sync_job` starts with the account id.

### Backend: `GET /admin/marketplace-connections/:id/sync-status`

A proxy exactly like `import-preview` (`respond`, `callSellerHub`, `connectionPath`), timeout 15 000 ms. Seller-hub down surfaces as the existing 502 body.

### Dashboard: `ChannelSyncStatusPanel`

- Mounted in the sales-channel marketplace section for Shopify and WooCommerce connections that are not Amazon. Unlike the import panel it is also shown for read-only (legacy) connections, because it only reads.
- Loads when the section renders and refetches every 30 seconds while the page is visible; a "Refresh" button refetches now.
- Shows: a banner when the backend call fails ("seller-hub is not reachable", with the returned message) instead of any stale numbers; a "sync is not running" notice when `sync_live` is false; listing counts (total, by status, with error, never pushed); a small table of the five job kinds with pending, processing, failed counts and the last success time; a table of recent failures (kind, SKU or id, attempts, message, time) with "Showing N of M" when `failures_total` exceeds the list.
- New text in `en.json` and `$schema.json`.

### Rulings (recommended choices, taken)

- Polling, not push: 30 s refetch is enough for an owner screen and needs no new infrastructure.
- Failures are listed, not retried. A failed job is retried by the existing sync machinery (reconcile and webhooks); a manual retry needs its own design.
- "Failed" job rows from the SKU link step (`sync_type='product'`) are included, because they are how unmatched and duplicate SKUs are reported today.
- Per-listing detail pages are not built; the failures table is the drill-down.

### Testing

- Seller-hub: the query function against the guarded test database with seeded accounts, listings and jobs (counts per status, never_pushed, newest-first failures capped at 25 with `failures_total`, another account's rows excluded, sanitization and truncation); route tests for 401, 404, success without a live runtime, `sync_live` true and false.
- Backend: proxy spec like the import routes (path, method, timeout, error passthrough).
- Dashboard: panel spec for the full view, the error banner (no numbers shown), the not-running notice, the "Showing N of M" line, refetch on Refresh; hook spec for the query key and the polling interval.
- Verification at the end repeats the suites used in Phase 4a.

## Not in this spec

Retrying or cancelling jobs, per-listing detail, an all-connections overview page, alerting or notifications, queue depth from Redis (BullMQ counts), Amazon.
