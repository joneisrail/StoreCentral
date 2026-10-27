# Consolidate StoreCentral into test-project

## Context and goal

StoreCentral (`C:\Users\jonei\claude work\StoreCentral\StoreCentral`) is a fork of the
Medusa v2 core monorepo, carrying three custom features built this cycle: the
EasyPost fulfillment provider, Order Notes & Tags, and the Order Ready-to-Ship
fulfillment list. test-project (`C:\Users\jonei\test-project`, the "Medusa DTC
Starter") is a separate Turborepo monorepo holding the actual product: a Medusa
backend (`apps/backend`), a Next.js storefront (`apps/storefront`), a
point-of-sale app (`apps/pos`, early-stage scaffold), and a worker service
(`apps/seller-hub`). Today, `apps/backend` declares Medusa's packages as normal
published npm versions, but the repo root's `resolutions` field silently
redirects them to StoreCentral's local source via `file:` paths — a
"test the fork before publishing" arrangement, not a permanent one.

The goal: maintain one repository going forward, not two. test-project is the
survivor — it already holds the storefront and POS apps, which StoreCentral
has none of. StoreCentral's `packages/` tree (the forked Medusa core, with this
cycle's three features already built into it) moves into test-project as its
own workspace, replacing the `file:` resolution arrangement entirely.

**Non-goals:**
- Re-implementing the three features as standard, unforked Medusa
  customizations. Some of this cycle's work edits Medusa's own core package
  files directly (e.g. `packages/medusa/src/api/admin/orders/validators.ts`,
  `packages/core/core-flows/src/order/workflows/get-orders-list.ts`) — not new
  standalone modules a vanilla Medusa project could add via its own
  `src/api`/`src/modules`. test-project keeps forking Medusa core, now inside
  one repository instead of two.
- Deleting or archiving StoreCentral. It stays exactly as-is, untouched,
  throughout this work and afterward — this is a copy into test-project, not a
  move out of StoreCentral. Archiving StoreCentral is a separate decision for
  later, made only once test-project is confirmed to work standalone, and only
  with explicit confirmation at that time.
- Preserving StoreCentral's git history for the moved files. The files land in
  test-project as a fresh addition.

## Scope: what moves

Medusa v2's core packages are tightly interdependent via `workspace:*`
references, and `@medusajs/medusa` registers most of the vanilla commerce
modules by default. There is no clean way to bring over only the files this
cycle's three features touched — the full `packages/` tree must move, because
`packages/medusa` and `packages/core/core-flows` (etc.) depend on every other
local package in the graph, not just the ones with custom edits.

**Moves into `test-project/packages/`:**
- `core/*` (framework, types, utils, workflows-sdk, core-flows, modules-sdk,
  query, orchestration, js-sdk, instantsearch-adapter)
- `medusa` (the main server package)
- `modules/*` (all 32 commerce modules, including `providers/*`, not only the
  ones touched this cycle — `@medusajs/medusa` depends on the full set)
- `admin/*` (dashboard, admin-sdk, admin-bundler, admin-shared,
  admin-vite-plugin)
- `cli/*` (create-medusa-app, http-types-generator, medusa-cli, oas/*)
- `design-system/*` (icons, toolbox, ui, ui-preset)
- `plugins/*` (draft-order, loyalty)
- `eslint-plugin`, `deps`, `medusa-telemetry`, `medusa-test-utils`

**Does not move:**
- `www/` — the Medusa documentation site. Irrelevant to the product; stays
  behind in StoreCentral.
- StoreCentral's top-level `integration-tests/` directory. test-project's own
  `apps/backend/integration-tests` is the equivalent home for backend tests
  going forward; StoreCentral's integration test files for the three custom
  features (`order.spec.ts` additions, `orders-fulfillments-batch.spec.ts`,
  the dashboard `.spec.tsx` files already colocated with their components)
  travel with the packages that own them, since they already live inside
  `packages/` or will be placed under `apps/backend/integration-tests` as part
  of this move — see "HTTP integration tests" below.

## Directory structure in test-project

`test-project/packages/*` becomes a new top-level directory, sibling to
`apps/*`, mirroring StoreCentral's own one-level-down layout (e.g.
StoreCentral's `packages/core/core-flows` becomes test-project's
`packages/core/core-flows`, same relative shape).

**Root `test-project/package.json`:**
- Add `"packages/**"` to the `workspaces` array (currently just `"apps/**"`
  plus the `.medusa` build-output exclusion, which stays).
- Remove the `resolutions` block entirely — every package it currently
  redirects becomes a real local workspace member instead.

**`apps/backend/package.json`:**
- Change every `@medusajs/*` dependency currently pinned to a published
  version (e.g. `"@medusajs/medusa": "2.21.2"`) to `"workspace:*"`, matching
  how StoreCentral's own packages reference their siblings.
- `@dtc/fulfillment-easypost` keeps its current `file:` reference updated to
  point at its new in-repo location
  (`file:../../packages/modules/providers/fulfillment-easypost` or the
  workspace-protocol equivalent, whichever this repo's convention prefers once
  it's a real sibling workspace).

**HTTP integration tests:** StoreCentral's `integration-tests/http/__tests__/order/admin/`
holds the HTTP-level tests for the three features (`order.spec.ts`'s
additions, `orders-fulfillments-batch.spec.ts`). These move into
`apps/backend/integration-tests/http/__tests__/order/admin/` (test-project's
existing equivalent location), not into the new `packages/` tree — they test
the running backend, not a package in isolation, matching where test-project
already keeps its own backend integration tests.

## Config reconciliation

**Yarn (`.yarnrc.yml`):** both repos pin `yarn@3.2.1`, but test-project's
`.yarnrc.yml` today is a single line (`nodeLinker: node-modules`) while
StoreCentral's additionally pins a yarn binary (`yarnPath`), sets
`checksumBehavior: ignore`, `compressionLevel: 0`, `nmMode: hardlinks-global`,
and loads two plugins (`plugin-workspace-tools`, `plugin-interactive-tools`).
test-project adopts StoreCentral's `.yarnrc.yml` wholesale, **except**
`nmMode`, which is set to `hardlinks-local` from the start rather than
`hardlinks-global`. `hardlinks-global` shares a file's hardlink count across
every worktree and install referencing the same cached package on disk;
Windows NTFS caps a single file at 1024 hardlinks, and this was actually hit
once already this cycle on a small, widely-shared package (`uuid`) once
enough StoreCentral worktrees had been created in one session. A consolidated
single repo makes this worse, not better, so this is a deliberate deviation
from "adopt wholesale."

**Turbo (`turbo.json`):** test-project's uses the current `"tasks"` key
(`build`, `dev`, `start`, `lint`, `test`, `seed`); StoreCentral's uses the
older `"pipeline"` key (`build`, `build:plugin`, `test`, `test:integration`,
`test:integration:chunk`) plus a `globalDependencies` entry. These merge into
one `turbo.json` using the `"tasks"` key (test-project's, since it's the
current schema), carrying over StoreCentral's task definitions that
test-project doesn't already have (`build:plugin`, the `test:integration*`
variants) and keeping test-project's app-oriented ones (`dev`'s
`persistent: true`, `seed`).

**Root `devDependencies` version conflicts:** both roots pin shared tooling
(`react`, `typescript`, `@swc/core`, `prettier`, `eslint`, etc.), likely at
different versions. Resolution rule: anything Medusa-internal-tooling-related
(`@swc/core`, `@swc/jest`, testing-library packages, the Medusa eslint plugin)
takes StoreCentral's version, since the fork was built and tested against it;
anything storefront/POS-specific that StoreCentral has no stake in keeps
test-project's version. Where the same package has conflicting requirements
from both sides for a reason not yet identified, that specific conflict is
surfaced in the implementation plan rather than resolved silently here.

## Verification plan

After the move and config reconciliation:
1. `yarn install` completes cleanly (no unresolved peer dependency errors, no
   hardlink ceiling errors).
2. `yarn build` succeeds across the full workspace (both the moved
   `packages/*` and the existing `apps/*`).
3. `apps/backend` boots against a real local Postgres instance.
4. Each of the three features is exercised against the running backend, not
   just confirmed to build:
   - EasyPost provider: a fulfillment can be created and a label purchased (or
     the existing test coverage for this is run and passes).
   - Order Notes & Tags: a note can be added to an order; bulk tagging works
     from the admin order list.
   - Order Ready-to-Ship: the Ready to Ship / Shipped tabs render, single-row
     and bulk Fulfill both work end-to-end.
5. The existing test suites that moved — both the package-level ones already
   colocated with their source (e.g. `order-parcel.spec.ts`,
   `ready-to-ship-table.spec.tsx`) and the relocated HTTP integration tests —
   are run and pass in their new location.

## Safety

This is additive to test-project and non-destructive to StoreCentral.
StoreCentral is read from, never written to or deleted from, for the duration
of this work. Nothing in StoreCentral is removed, archived, or altered as
part of this plan. test-project's own pre-existing uncommitted changes (a
benign, unrelated `yarn.lock`/`package.json` resolution-sync entry for
`@medusajs/note`, already present before this work started) are left alone
unless they conflict with the resolutions-block removal, in which case the
plan's own first task resolves that conflict explicitly rather than silently.

## Open questions for the implementation plan to resolve, not this spec

- The exact mechanics of the file move (bulk copy via a script vs. a sequence
  of per-package copies) — an implementation detail, not a design decision.
- Whether any devDependency version conflict beyond the general rule above
  needs a specific, named resolution.
- Whether `apps/backend`'s own `integration-tests` setup (its Jest config,
  test-database bootstrapping) already matches StoreCentral's conventions
  closely enough for the relocated HTTP tests to run unmodified, or needs
  adaptation.
