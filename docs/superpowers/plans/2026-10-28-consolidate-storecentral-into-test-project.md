# Consolidate StoreCentral into test-project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move StoreCentral's `packages/` tree (the forked Medusa core, with the EasyPost provider, Order Notes & Tags, and Order Ready-to-Ship features already built in) into test-project as its own workspace, replacing the current `file:`-resolution arrangement, so test-project becomes the single repository going forward.

**Architecture:** A one-time bulk copy of StoreCentral's `packages/*` into a new `test-project/packages/*` workspace, followed by reconciling root-level config (workspace globs, yarn settings, Turborepo pipeline) and `apps/backend`'s own dependency declarations so the copied packages resolve as real local workspace members instead of `file:` redirects into a different repository. StoreCentral itself is read-only throughout and untouched afterward.

**Tech Stack:** Yarn 3.2.1 (node-modules linker), Turborepo, Jest (`@medusajs/test-utils`), Medusa v2.

**Spec:** `docs/superpowers/specs/2026-10-28-consolidate-storecentral-into-test-project-design.md`

## Global Constraints

- Source of truth for what moves: `core/*`, `medusa`, `modules/*` (all 32, including `providers/*`), `admin/*`, `cli/*`, `design-system/*`, `plugins/*`, `eslint-plugin`, `deps`, `medusa-telemetry`, `medusa-test-utils` — copied from `C:\Users\jonei\claude work\StoreCentral\StoreCentral\packages\`. `www/` and StoreCentral's top-level `integration-tests/` do not move.
- Fresh copy only — no git history transplant for the moved files.
- StoreCentral is read-only input to this plan. No task deletes, moves, or modifies anything inside it. Nothing about StoreCentral's own git state changes.
- Root `test-project/package.json`: add `"packages/**"` to `workspaces`; remove the `resolutions` block entirely.
- `apps/backend/package.json`: every `@medusajs/*` dependency currently pinned to a published version becomes `"workspace:*"`. `@dtc/fulfillment-easypost`'s `file:` path is updated to its new in-repo location.
- `.yarnrc.yml`: adopt StoreCentral's settings wholesale (`yarnPath`, `checksumBehavior: ignore`, `compressionLevel: 0`, the two plugins) **except** `nmMode`, which is set to `hardlinks-local`, not StoreCentral's `hardlinks-global` — `hardlinks-global` shares a file's hardlink count across every install referencing the same cached package, and Windows NTFS's 1024-hardlink-per-file ceiling was already hit once this way during StoreCentral's own development.
- `turbo.json`: one merged file using the current `"tasks"` key (test-project's schema, not StoreCentral's older `"pipeline"` key), containing every task name that exists in either source file.
- devDependency version conflicts: Medusa-internal-tooling packages (`@swc/core`, `@swc/jest`, testing-library packages, `@medusajs/eslint-plugin`) take StoreCentral's pinned version; storefront/POS-only packages keep test-project's version; anything else is a named, documented decision in that task's commit message, not a silent pick.
- **Deviation from the spec's literal wording, decided during planning (see Task 6):** the spec says `order.spec.ts`'s "additions" move into `apps/backend/integration-tests`. Verified during planning that `order.spec.ts` is a large, pre-existing Medusa core test file covering vanilla order-admin behavior unrelated to this fork's three custom features — moving it whole would duplicate coverage test-project doesn't own and doesn't need. Ruling: only the specific test case(s) added for the `fulfillment_status`/`payment_status` filters land in a new, purpose-built file; `orders-fulfillments-batch.spec.ts` (wholly new, not an addition to an existing file) moves as a complete unit.
- **Deviation from the spec's literal wording, decided during planning (see Task 6):** the spec's non-goal says StoreCentral's top-level `integration-tests/` doesn't move, but the relocated tests transitively depend on shared fixture/helper code that lives there (`integration-tests/http/src/fixtures/{order,shipping}.ts`, `integration-tests/modules/__tests__/fixtures`). Ruling: Task 6 traces and copies only the specific fixture functions these two test files actually call (not the surrounding fixture tree) into a new `apps/backend/integration-tests/fixtures/` directory.

## Review Focus

- A stale, npm-cached version of an `@medusajs/*` package coexisting with the newly-added local workspace package of the same name could let `yarn install` silently resolve to the wrong one instead of erroring. (Task 4)
- `@dtc/fulfillment-easypost`'s own `package.json` may declare a `@medusajs/framework` peer/dependency version string that no longer lines up once consumed via `workspace:*` instead of a published version — this should surface as an explicit install warning/error to fix, not pass silently. (Task 4)
- The merged `turbo.json` accidentally drops a task either source file defined (e.g. test-project's `seed`, or StoreCentral's `build:plugin`/`test:integration:chunk`) — a reasonable person who used one of those tasks before the merge would expect it to still work after. (Task 2)
- A literal `file:C:/Users/jonei/claude work/StoreCentral/StoreCentral/...` path survives somewhere beyond the two `package.json` files this plan names explicitly (a `.env` value, a script, a CI config) and silently keeps pointing at the old location after the packages have moved. (Task 3)
- The relocated integration tests fail not because of a real regression but because their shared fixture/helper dependencies (`createOrderSeeder`, `createDistinctOrderSeeder`, `createShippingOptionSeeder`, `setupTaxStructure`) weren't traced completely, so a reasonable person reading a red test here would wrongly suspect the migrated feature code itself. (Task 6)

---

## Task 1: Copy StoreCentral's packages tree into test-project

**Files:**
- Create: `packages/**` in test-project (bulk copy; see Global Constraints for the exact list of source directories)

**Interfaces:**
- Produces: the raw package source tree on disk at `test-project/packages/*`, not yet wired into any workspace config (that's Task 2). Later tasks assume this tree exists at exactly the same relative shape as StoreCentral's own `packages/*` (e.g. `packages/core/core-flows`, `packages/modules/order`, `packages/admin/dashboard`).

- [ ] **Step 1: Copy each directory named in Global Constraints**

From `test-project/`, for each of `core`, `medusa`, `modules`, `admin`, `cli`, `design-system`, `plugins`, `eslint-plugin`, `deps`, `medusa-telemetry`, `medusa-test-utils`, copy the corresponding directory/file from `C:\Users\jonei\claude work\StoreCentral\StoreCentral\packages\<name>` into `test-project\packages\<name>`. (`medusa`, `eslint-plugin`, `deps`, `medusa-telemetry`, `medusa-test-utils` are single packages, not directories of packages — copy each one directly under `packages/`.)

- [ ] **Step 2: Strip build artifacts and caches that may have been copied along**

Remove any `node_modules`, `dist`, `.turbo`, `.medusa`, `.yarn` directory found anywhere under the newly-copied `packages/` tree — these are build/install outputs from StoreCentral's own checkout, not source.

- [ ] **Step 3: Verify completeness**

For every directory copied, confirm it contains a `package.json` at the expected depth (one level under `core`/`modules`/`admin`/`cli`/`design-system`/`plugins`, or directly for the five single packages). Compare the resulting package name list against StoreCentral's own `packages/*/package.json` `name` fields for the same source directories — every name must appear exactly once in test-project's copy.

Expected: no missing package, no package with a missing or empty `package.json`, no leftover `node_modules`/`dist`/`.turbo`/`.medusa` directory anywhere under `test-project/packages/`.

- [ ] **Step 4: Commit**

```bash
git add packages/
git commit -m "chore: copy StoreCentral's packages tree into test-project"
```

---

## Task 2: Root config reconciliation

**Files:**
- Modify: `test-project/package.json`
- Modify: `test-project/.yarnrc.yml`
- Modify: `test-project/turbo.json`
- Create: `test-project/.yarn/releases/yarn-3.2.1.cjs`, `test-project/.yarn/plugins/@yarnpkg/plugin-workspace-tools.cjs`, `test-project/.yarn/plugins/@yarnpkg/plugin-interactive-tools.cjs` (copied from StoreCentral's own `.yarn/` — `.yarnrc.yml`'s `yarnPath`/`plugins` entries reference these exact paths, so they must exist in test-project too)

**Interfaces:**
- Consumes: Task 1's `packages/*` tree (must already be on disk for the workspace glob to mean anything once yarn runs, though this task only edits config — it doesn't run yarn itself).
- Produces: a root config that, once yarn runs (Task 4), will discover `packages/*` as real workspace members and stop redirecting `@medusajs/*` names to an external `file:` path.

- [ ] **Step 1: Add `packages/**` to the root workspace glob**

In `test-project/package.json`'s `workspaces` array (currently `["apps/**", "!apps/backend/.medusa/**"]`), add `"packages/**"`.

- [ ] **Step 2: Remove the `resolutions` block**

Delete the entire `resolutions` field from `test-project/package.json` — every `@medusajs/*` entry it currently redirects to a StoreCentral `file:` path.

- [ ] **Step 3: Copy and adjust `.yarnrc.yml`**

Copy StoreCentral's `.yarnrc.yml` content into `test-project/.yarnrc.yml` verbatim, then change `nmMode: hardlinks-global` to `nmMode: hardlinks-local` (per Global Constraints — this is the one deliberate deviation from a verbatim copy).

- [ ] **Step 4: Copy the referenced yarn binary and plugins**

Copy `C:\Users\jonei\claude work\StoreCentral\StoreCentral\.yarn\releases\yarn-3.2.1.cjs` and the two plugin `.cjs` files under `.yarn/plugins/@yarnpkg/` into the matching paths under `test-project/.yarn/`.

- [ ] **Step 5: Merge `turbo.json`**

Produce one `test-project/turbo.json` using the `"tasks"` key. Union of task names from both source files: `build`, `build:plugin`, `dev`, `start`, `lint`, `test`, `test:integration`, `test:integration:chunk`, `seed`. Keep test-project's existing definitions for `dev` (`cache: false`, `persistent: true`), `start`, `lint`, `seed`. Add StoreCentral's definitions for `build:plugin` and the two `test:integration*` variants. For `build` and `test`, where both sides define the task, keep test-project's `build` (its `outputs` already covers `.next/**`, which StoreCentral's doesn't need but test-project's apps do) and keep test-project's `test`.

- [ ] **Step 6: Verify every pre-existing task name from both source files is present**

List the task names in the merged file; confirm it's a superset of `{build, dev, start, lint, test, seed}` (test-project's original set) and `{build, build:plugin, test, test:integration, test:integration:chunk}` (StoreCentral's original set). This is the Review Focus check for this task — do it explicitly, not by assuming the merge in Step 5 was complete.

- [ ] **Step 7: Commit**

```bash
git add package.json .yarnrc.yml turbo.json .yarn/
git commit -m "chore: reconcile root workspace/yarn/turbo config for the packages move"
```

---

## Task 3: Rewire apps/backend's dependencies

**Files:**
- Modify: `apps/backend/package.json`
- Test: a repo-wide grep (see Step 3), not a new test file

**Interfaces:**
- Consumes: Task 1's `packages/*` tree (the workspace package names must match what this task points `apps/backend` at), Task 2's workspace glob (so `workspace:*` has something to resolve against once yarn runs).
- Produces: `apps/backend/package.json` with no remaining reference to the external StoreCentral path.

- [ ] **Step 1: Change pinned `@medusajs/*` versions to `workspace:*`**

In `apps/backend/package.json`, change every dependency currently pinned to `"2.21.2"` (or any other fixed version) whose package now exists under `test-project/packages/` to `"workspace:*"`.

- [ ] **Step 2: Update `@dtc/fulfillment-easypost`'s path**

Change `"@dtc/fulfillment-easypost": "file:C:/Users/jonei/claude work/StoreCentral/StoreCentral/packages/modules/providers/fulfillment-easypost"` to `"workspace:*"` (it's now a sibling workspace package under `test-project/packages/modules/providers/fulfillment-easypost`, not an external file path).

- [ ] **Step 3: Grep the whole repo for the old absolute path**

Run a repo-wide search for the literal string `StoreCentral/StoreCentral/packages` (or `claude work\StoreCentral\StoreCentral\packages` for the Windows-path form) across every file in `test-project`, not just `package.json` files — this is the Review Focus check for this task. Fix any `.env`/`.env.template` value, script, or config file that still points at the old external location.

Expected: zero matches after this step, anywhere in the repo.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/package.json
git commit -m "chore: point apps/backend at the local packages workspace instead of StoreCentral's file: path"
```

(If Step 3 found and fixed matches outside `apps/backend/package.json`, include those files in this commit too.)

---

## Task 4: Clean install

**Files:**
- Modify: `yarn.lock`, and whichever file(s) Review Focus items 1-2 require fixing once a real conflict surfaces (cannot be named exactly in advance — see Steps 2-3)

**Interfaces:**
- Consumes: Tasks 1-3's combined state (packages present, root config pointing at them, `apps/backend` referencing them by workspace protocol).
- Produces: a clean `yarn.lock` with no install errors, ready for Task 5's build.

- [ ] **Step 1: Run `yarn install` from the repo root**

- [ ] **Step 2: If it fails on a devDependency version conflict, resolve per the Global Constraints rule**

Medusa-internal-tooling packages take StoreCentral's version; storefront/POS-only packages keep test-project's version; anything not covered by that rule gets a one-line note in this task's commit message explaining the specific choice made, not a silent pick. Re-run `yarn install` after each fix.

- [ ] **Step 3: Specifically check the two Review Focus risks for this task**

(a) Every `@medusajs/*` package that exists under `test-project/packages/` resolves in `yarn.lock` via the `workspace:` protocol, not a cached npm registry version — grep `yarn.lock` for each such package name and confirm. (b) `@dtc/fulfillment-easypost`'s own dependency/peerDependency declarations on `@medusajs/framework` (or any other now-local package) don't produce an unmet-peer warning — read the install output for any warning naming that package and resolve it if one appears.

Expected: `yarn install` exits 0, with neither risk's failure mode present.

- [ ] **Step 4: Commit**

```bash
git add yarn.lock
git commit -m "chore: clean install after the packages workspace move"
```

---

## Task 5: Clean build

**Files:**
- None expected beyond what Task 4 already touched — this task is verification-only unless a build failure requires a source fix, in which case the fix lands in whichever file the build error names.

**Interfaces:**
- Consumes: Task 4's clean install.
- Produces: a working `dist`/build output for every package and app, proving the moved source actually compiles together, not just installs.

- [ ] **Step 1: Run `yarn build` from the repo root**

- [ ] **Step 2: If a package fails to build, diagnose and fix**

A build failure at this point most likely means a cross-package type or import mismatch introduced by the config changes in Tasks 2-3 (not a pre-existing StoreCentral bug, since StoreCentral itself builds cleanly before this plan starts) — trace it to its actual cause before changing anything, per this project's systematic-debugging practice.

- [ ] **Step 3: Verify**

Expected: `yarn build` exits 0 for the whole workspace (`packages/*` and `apps/*`).

- [ ] **Step 4: Commit**

Only if Step 2 required a source change:

```bash
git add <files touched in Step 2>
git commit -m "fix: resolve build error surfaced by the packages workspace move"
```

---

## Task 6: Relocate the custom features' HTTP integration tests

**Files:**
- Create: `apps/backend/integration-tests/http/order-fulfillment-status-filters.spec.ts` (the specific `fulfillment_status`/`payment_status` filter test case(s) added to StoreCentral's `order.spec.ts` — not that whole file; see Global Constraints)
- Create: `apps/backend/integration-tests/http/orders-fulfillments-batch.spec.ts` (StoreCentral's file of the same name, moved as a complete unit)
- Create: `apps/backend/integration-tests/fixtures/` — the minimal, traced set of fixture functions these two files actually call (see Step 1)

**Interfaces:**
- Consumes: Task 5's working build (these tests run against the built/compiled workspace).
- Produces: nothing later tasks consume — this is the last content-producing task before Task 7's pure verification.

- [ ] **Step 1: Trace each test file's actual fixture dependencies**

Starting from StoreCentral's `integration-tests/http/__tests__/order/admin/order.spec.ts` (the specific added test case(s), identified by searching that file's own `it()` blocks for `fulfillment_status`/`payment_status`) and `integration-tests/http/__tests__/order/admin/orders-fulfillments-batch.spec.ts`, follow every import that resolves to `integration-tests/http/src/fixtures/*` or `integration-tests/modules/__tests__/fixtures` (confirmed starting points: `createOrderSeeder`, `createDistinctOrderSeeder`, `createShippingOptionSeeder`, `setupTaxStructure`), and recursively follow THEIR imports too, until every function the two target test files transitively need is identified. Do not copy the surrounding fixture directories wholesale — only the specific functions in this traced set, each into `apps/backend/integration-tests/fixtures/`.

- [ ] **Step 2: Create the two new spec files, adapted**

Extract the fulfillment_status/payment_status filter test case(s) into `order-fulfillment-status-filters.spec.ts`; copy `orders-fulfillments-batch.spec.ts` whole. In both, update import paths to point at Step 1's new `apps/backend/integration-tests/fixtures/` location and at `apps/backend`'s own module/route source (now living under `apps/backend`'s normal source resolution via the Task 3 workspace wiring, not a relative path into a separate repo).

- [ ] **Step 3: Run the two relocated test files**

Run: `yarn test --filter=@dtc/backend -- order-fulfillment-status-filters` and the equivalent for `orders-fulfillments-batch`, from the repo root (or `apps/backend`'s own test command directly if that's more direct — check `apps/backend/package.json`'s `test` script).

Expected: both pass. If either fails, use Step 1's traced dependency list to check for a missed transitive fixture before suspecting the migrated feature code itself (this is the Review Focus risk for this task).

- [ ] **Step 4: Commit**

```bash
git add apps/backend/integration-tests/
git commit -m "test: relocate fulfillment-status-filter and bulk-fulfill HTTP tests into apps/backend"
```

---

## Task 7: End-to-end verification

**Files:** None — this task produces no new files, only a verification record in its own report/commit message.

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: the signal that this plan is actually done — not just "builds and unit-tests pass" but "the three features work against a running backend."

- [ ] **Step 1: Boot `apps/backend` against a real local Postgres instance**

- [ ] **Step 2: Exercise the EasyPost fulfillment provider**

Create a fulfillment for a real order through the admin API or dashboard and confirm a label is purchased (or confirm the existing EasyPost-specific test coverage — `apps/backend/integration-tests/http/easypost-webhook.spec.ts`, `fulfillment-queue.spec.ts` — already exercises this and passes).

- [ ] **Step 3: Exercise Order Notes & Tags**

Add a note to an order and bulk-tag two or more orders from the admin order list; confirm both work.

- [ ] **Step 4: Exercise Order Ready-to-Ship**

Confirm the Ready to Ship / Shipped tabs render on the admin order list, single-row Fulfill (via its confirm popover) works end-to-end, and bulk "Fulfill selected" works end-to-end (including its confirm prompt).

- [ ] **Step 5: Run the full workspace test suite**

Run: `yarn test` from the repo root.

Expected: every test suite passes, including Task 6's relocated tests and every pre-existing `apps/backend` test.

- [ ] **Step 6: Record the result**

No commit needed unless Step 2-4 surfaced a bug requiring a fix elsewhere in the plan's work (in which case, fix it in the task whose output it belongs to, not here). If this task found nothing wrong, note that in the final report to the human partner.
