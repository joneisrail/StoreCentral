# Decision 0001: how StoreCentral carries Medusa

Status: accepted (Phase 3 of the roadmap), 2026-11-23.
Proposed owner: the repository owner (GitHub user `joneisrail`); change this line if someone else takes it.
Review cadence: look at every upstream Medusa release monthly; apply security releases within 7 days; re-read this record at the next major upgrade.

## Context

The repository vendors the whole Medusa source tree under `packages/` (9,229 tracked files, version 2.21.2) and the backend consumes it as `workspace:*` dependencies. The copy was committed on 2026-10-28 (`017b40571c`). Upstream published 2.23.0 on 2026-11-20 and has released 9 stable versions since 2.21.2 (2026-09-28). The roadmap risk R3 was "security and bug fixes must be merged by hand".

### What we changed in the vendored tree (measured)

Server side, since the import commit (from `git diff`): 20 files, about 2,250 lines, nearly all in two features:

| Area | Files | What |
|---|---|---|
| `packages/core/core-flows` | 8 | bulk fulfil step and workflows (`bulk-fulfill-orders`, `create-fulfillment`, `resolve-easypost-provider`) with their tests |
| `packages/medusa` | 3 | `/admin/orders/fulfillments/batch` route and validators, plus a validators test |
| `packages/core/js-sdk` | 1 | `admin/order.ts` |
| `packages/admin/admin-bundler` | 1 | one line in `config.ts` |
| `packages/modules/providers/fulfillment-easypost` | 5 | our own package, `@dtc/fulfillment-easypost` 0.1.0, not an upstream package |
| `packages/design-system` | 2 | generated icon statistics pages |

Not measurable: whether the tree already differed from upstream 2.21.2 at import time. npm publishes only compiled `dist` for the server packages, so a source diff against upstream is impossible there. This is an open risk (see Risks).

Dashboard (`packages/admin/dashboard`, 2,141 tracked files). It is the only package npm publishes WITH its `src/`, so it could be diffed exactly against `@medusajs/dashboard@2.21.2`:

| Measure | Result |
|---|---|
| Files only in our fork | 106 (71 under `routes/orders/order-list`, 11 under `hooks/api`, 5 order detail, 4 sales-channel detail, plus others) |
| Files only upstream | 1 (`order-note-form.tsx`) |
| Files modified | 333; 13 differ only in whitespace, 251 differ by 10 lines or fewer (mostly formatting and class ordering from the earlier lint cleanup), 69 differ by more than 10 lines |
| Lines changed in the 333 modified files, ignoring whitespace | about 3,900 |
| Biggest real changes | `dashboard-app/routes/get-route.map.tsx` (474), `i18n/translations/en.json` (277), `hooks/api/orders.tsx` (220), order timeline (183), order table columns (119), order list table (109) |

Rehearsal of an upgrade to upstream 2.23.0 (scratch copies, repository untouched; line endings normalised on all three sides; procedure in `docs/ops/upstream-sync.md`):

| Of the 616 dashboard files upstream changed between 2.21.2 and 2.23.0 | Files |
|---|---|
| Our fork never touched them (take upstream as is) | 311 |
| Our fork already equals upstream 2.23.0 | 87 |
| Both changed, git merges cleanly | 99 |
| Both changed, conflict | 117 |
| Absent from our fork | 2 |

The 117 conflicts were not classified by cause. Part of them is formatting churn from our earlier lint cleanup (the fork was reformatted by prettier with Tailwind class sorting; upstream has since adopted the same sorting, which is why 87 files already match). The real, hand-resolved work is therefore at most 117 files, probably fewer.

Correction to the Phase 0 audit: `origin/develop` is not an upstream Medusa mirror. Its merge base with `master` is our own PR #1 (2026-10-25). The repository has no upstream history; the only upstream relationship is the version number and the published npm packages.

## Options considered

A. Keep everything vendored, add a documented merge procedure. Server packages cannot be diffed against upstream (dist only), so every upgrade would be a blind copy-over of 9,000 files, redoing our 20 modified files by hand. No automatic security patches. Docker and CI already pay for building all of it (Phase 1 hit this).

B. Move everything to published `@medusajs/*` packages, including the dashboard, and rebuild our UI as admin extensions. Medusa's extension mechanism adds routes and widgets; it cannot replace or reshape core pages. Our dashboard changes alter core pages (orders list and detail, sales channel pages, the route map, i18n). Re-doing about 19,700 lines of dashboard changes as extensions is the most expensive and riskiest path.

C. Hybrid: use published packages for the whole server side and keep only the dashboard vendored. The vendored surface shrinks from 9,229 files to about 2,141, and the one package that remains is exactly the one where we can diff against upstream and where our customisations genuinely live.

## Decision

Adopt option C.

1. Server side moves to published `@medusajs/*` packages, pinned to one exact version across the backend (start at 2.21.2 for parity, then upgrade deliberately). Our 20 server-side modifications are re-homed in the backend app as custom code, not edits to Medusa:
   - the bulk-fulfil workflow and step become a backend workflow under `apps/backend/src/workflows`;
   - the `/admin/orders/fulfillments/batch` behaviour becomes a backend API route (to be confirmed by a spike that an app route may take over that path; if it cannot, use a new path and point the dashboard at it);
   - the `js-sdk` change becomes `sdk.client.fetch` calls inside the dashboard fork;
   - `@dtc/fulfillment-easypost` stays a workspace package (it is our code); the other upstream copies under `packages/` are deleted.
2. The dashboard stays vendored at `packages/admin/dashboard`, with `UPSTREAM_VERSION` recording the upstream version it is based on, and is upgraded by the three-way merge procedure in `docs/ops/upstream-sync.md`, always to the same version as the server packages.
3. The migration itself is a separate piece of work (Phase 3b), gated by three spikes (below). This record does not change any code.

## Why

- Security and bug fixes for the server arrive through a normal version bump instead of hand merging.
- The only vendored code left is the part we really changed, and it is mergeable against upstream with a tool-assisted procedure (rehearsed above).
- Build and CI time drop: Docker and CI stop compiling about 7,000 upstream source files.
- It is the smallest change that removes the R3 risk without rewriting the dashboard.

## Consequences and costs

- One migration project (Phase 3b): dependency switch, re-homing of the server-side changes, Docker and CI changes, a full regression run.
- The dashboard fork must be upgraded in step with the server version; the procedure and the monthly review make that routine.
- Our own `@dtc/fulfillment-easypost` provider must keep matching the fulfillment provider API of the pinned version.

## Risks and how Phase 3b checks them first (spikes, each time-boxed, each a go/no-go)

1. Hidden drift in the server packages: because only `dist` is published, compare the behaviour of a build of our `packages/` against `@medusajs/*@2.21.2` (build output diff of each package, then run the backend test suites against the published packages). Any difference is either re-homed or recorded.
2. Route takeover: confirm in a throwaway backend that an app route can serve `/admin/orders/fulfillments/batch` in place of the core one (or choose a new path).
3. Dashboard against published `@medusajs/ui`, `icons`, `js-sdk`, `types`: confirm the forked dashboard builds and its 666 tests pass with those packages from npm instead of the workspace.

If spike 1 or 3 fails, fall back to option A for that package only and write down why.

## Not decided here

Whether to upgrade to 2.23.0 or newer (decided after the migration lands, using the sync procedure); channel features (Phase 4); POS and reports (Phase 5).
