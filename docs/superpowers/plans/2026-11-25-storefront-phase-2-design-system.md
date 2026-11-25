# Storefront Phase 2: Premium Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-theme the existing storefront to the brief's luxury look (ivory, charcoal, champagne gold, serif headings) through tokens and restyled wrappers, add drawer, dropdown, toast and skeleton primitives, and a dev-only `/design-system` preview page.

**Architecture:** One `tokens.css` overrides the `@medusajs/ui-preset` CSS variables that the 267 existing `ui-*` classes read, so screens re-theme without edits. The storefront's own wrappers in `src/modules/common/components/ui/index.tsx` are restyled in place (same props). New primitives live under `src/modules/common/components/<name>/index.tsx`.

**Tech Stack:** Next 15.5, React 19.0.5, Tailwind 3 with the vendored ui-preset, `@headlessui/react` 2.2, `next/font/google`, Vitest 4 with jsdom and `@testing-library/user-event`.

**Spec:** `docs/superpowers/specs/2026-11-25-storefront-phase-2-design-system-design.md`

## Global Constraints

- Work only in `apps/storefront`, plus `deploy/` and `.env.example` for the new `NEXT_PUBLIC_STORE_NAME` variable and `docs/storefront/`. No semicolons, double quotes, 2-space indent, kebab-case files, no emojis (repo `AGENTS.md`).
- Keep every existing component's props and `data-testid` values unchanged; screens must need no edits.
- Palette values (exact): ivory `#FAF7F2`, paper `#FFFFFF`, charcoal `#1E1D1B`, warm grey `#6F685E`, line `#E6DFD3`, strong line `#9A9183`, gold `#C2A361`, gold deep `#80651F`. Light mode only.
- Gold is never used as body text on ivory or paper; text that must be gold uses gold deep. All text pairs meet WCAG AA 4.5:1, large text and UI borders 3:1.
- Every interactive element has a visible focus ring (gold deep, 2px, 2px offset). Touch targets are at least 44px on screens below 1024px. Transitions and animations added here are disabled under `prefers-reduced-motion`.
- Fonts: `Cormorant Garamond` (weights 500, 600) as `--font-serif`, `Inter` as `--font-sans`, `display: "swap"`, via `next/font/google`.
- Do not install packages beyond `jsdom` (`^27.1.0`) and `@testing-library/user-event` (`^14.6.3`) as devDependencies of `@dtc/storefront`; both descriptors already exist in `yarn.lock`, so run the lockfile update only (`yarn install --mode update-lockfile`), never a full install.
- Tests: Vitest, jsdom per file via `// @vitest-environment jsdom`. Each task ends with `yarn typecheck`, `yarn lint` and `yarn test` in `apps/storefront` green (set `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_test NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://localhost:9000` for lint).
- A production `next build` fails inside a worktree nested under the repo (known, also on original master). Final verification builds a copy outside the worktree (Task 9).
- Worktree `.worktrees/storefront-phase-2`: link `node_modules` with directory junctions (PowerShell `New-Item -ItemType Junction`) for the repo root and `apps/storefront`, never `ln -s` (it copies thousands of files).

## Review Focus

- A very long product name or price in a product card must wrap or truncate inside the card, never overflow the grid (test in Task 7).
- A product with no thumbnail renders the placeholder at the same aspect ratio, so the grid does not shift (Task 7).
- Many toasts at once (10 in a row) must stack without covering the page and each stays dismissible; dismissing one never removes another (Task 5).
- A drawer with no focusable child, or opened from an element that unmounts, must not trap focus on nothing or lose it to the page behind; Escape and overlay click both close and focus returns to a still-mounted opener (Task 6).
- The web font failing to load must keep readable fallback text with no layout jump (fallback stack defined and checked in Task 3), and `prefers-reduced-motion` must remove the new animations (Tasks 3 and 5).

---

### Task 1: Test harness for components

**Files:**
- Modify: `apps/storefront/package.json`, `apps/storefront/vitest.config.ts`, `yarn.lock` (by command only)
- Create: `apps/storefront/src/test/render.tsx`, `apps/storefront/src/test/render.test.tsx`

**Interfaces:**
- Produces: `render(ui: React.ReactElement): { container: HTMLElement; unmount: () => void; rerender: (ui: React.ReactElement) => void }` (mounts into `document.body` through `react-dom/client` inside `act`), `cleanup(): void` (unmounts everything mounted), and re-exports `act` from `react` and `userEvent` from `@testing-library/user-event`.

- [ ] **Step 1: Write `render.test.tsx`** (`// @vitest-environment jsdom`): `render(<button>hi</button>)` puts a button with text "hi" in `document.body`; `userEvent.setup().click` on a button with an `onClick` spy calls the spy once; after `cleanup()` the body is empty.
- [ ] **Step 2: Run it, expect FAIL** (`yarn test src/test`): module missing.
- [ ] **Step 3: Add devDependencies** `jsdom` `^27.1.0` and `@testing-library/user-event` `^14.6.3` to `apps/storefront/package.json` (sorted), run `node .yarn/releases/yarn-3.2.1.cjs install --mode update-lockfile` from the repo root; confirm the `yarn.lock` diff is only the workspace entry lines.
- [ ] **Step 4: Implement `src/test/render.tsx`** per the Interfaces block; set `globalThis.IS_REACT_ACT_ENVIRONMENT = true`. Extend `vitest.config.ts` `include` to `src/**/*.test.{ts,tsx}` and add the `@lib`/`@modules` aliases for tsx (already present).
- [ ] **Step 5: Run `yarn test`, expect PASS** (16 existing tests plus the new ones), then `yarn typecheck`.
- [ ] **Step 6: Commit** `test(storefront): component test harness`.

### Task 2: Design tokens and contrast test

**Files:**
- Create: `apps/storefront/src/styles/tokens.css`, `apps/storefront/src/styles/tokens.test.ts`
- Modify: `apps/storefront/src/styles/globals.css`, `apps/storefront/tailwind.config.js`

**Interfaces:**
- Produces: CSS variables `--sc-ivory`, `--sc-paper`, `--sc-charcoal`, `--sc-warm-grey`, `--sc-line`, `--sc-line-strong`, `--sc-gold`, `--sc-gold-deep` on `:root` with the exact Global Constraints values; Tailwind colour keys `ivory`, `paper`, `charcoal`, `warm-grey`, `line`, `line-strong`, `gold`, `gold-deep` (utilities such as `bg-ivory`, `text-charcoal`, `border-line`); the `@medusajs/ui-preset` variables (`--bg-base`, `--bg-subtle`, `--bg-field`, `--fg-base`, `--fg-subtle`, `--fg-muted`, `--border-base`, `--border-strong`, `--button-inverted`, `--fg-interactive`, and their `-hover`/`-pressed` siblings that the existing classes read) re-pointed at the brand variables.

- [ ] **Step 1: Write `tokens.test.ts`** that reads `tokens.css`, parses `--sc-*` hex values, and asserts contrast ratios (WCAG relative luminance) of at least 4.5 for charcoal on ivory, charcoal on paper, warm-grey on ivory, warm-grey on paper, gold-deep on ivory, gold-deep on paper, ivory on charcoal, charcoal on gold; at least 3 for line-strong on paper and on ivory; and asserts every ui-preset variable listed in Interfaces is defined. If a Global Constraints value fails, adjust that one hex minimally, record it as a `Ruling:` in the commit body.
- [ ] **Step 2: Run, expect FAIL** (file missing).
- [ ] **Step 3: Create `tokens.css`** (brand variables plus the ui-preset overrides, light mode), import it in `globals.css` right after the Tailwind `base` import, add the Tailwind colour keys in `tailwind.config.js`, set `borderRadius` `soft: 2px`, `base: 4px`, `rounded: 6px`, `large: 12px` (keep `circle`), and set body defaults (`background: var(--sc-ivory)`, `color: var(--sc-charcoal)`).
- [ ] **Step 4: Run tests, expect PASS**; run `yarn typecheck` and `yarn lint`.
- [ ] **Step 5: Commit** `feat(storefront): design tokens and contrast test`.

### Task 3: Fonts, typography and store name

**Files:**
- Modify: `apps/storefront/src/app/layout.tsx`, `apps/storefront/src/styles/globals.css`, `apps/storefront/tailwind.config.js`, `apps/storefront/src/modules/common/components/ui/index.tsx` (`Text`, `Heading` only), `apps/storefront/.env.template`, `deploy/storefront.Dockerfile`, `deploy/docker-compose.yml`, `deploy/.env.example`
- Create: `apps/storefront/src/lib/util/store-name.ts`, `apps/storefront/src/lib/util/store-name.test.ts`

**Interfaces:**
- Produces: `getStoreName(env?: Record<string, string | undefined>): string` returning `NEXT_PUBLIC_STORE_NAME` trimmed, or `"Store"` when unset or blank; CSS variables `--font-serif` and `--font-sans` on `<html>`; Tailwind `fontFamily` `serif` and `sans` pointing at them with system fallbacks (`Georgia, "Times New Roman", serif` and the existing Inter fallback list).
- Consumes: Task 2 tokens.

- [ ] **Step 1: Write `store-name.test.ts`**: unset gives "Store", blank gives "Store", "  Fragrance House " gives "Fragrance House".
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `getStoreName`**, load both fonts with `next/font/google` in `layout.tsx` (variables above, `display: "swap"`), apply the variable classes to `<html>`, set `Heading` to the serif with the three levels' sizes and tracking, keep `Text` on the sans, and re-point the legacy `text-*-semi` / `txt-*` heading utilities in `globals.css` at the serif where they are headings (`text-2xl-semi`, `text-3xl-semi`).
- [ ] **Step 4: Add `NEXT_PUBLIC_STORE_NAME`** (optional) to `.env.template`, `storefront.Dockerfile` (ARG and ENV), compose build args and environment as `"${NEXT_PUBLIC_STORE_NAME:-}"`, and `deploy/.env.example` with a comment; run `node --test deploy/*.test.mjs` and fix any expectation that enumerates the storefront variables.
- [ ] **Step 5: Add a test** that `tailwind.config.js` `fontFamily.serif` and `.sans` each end with a generic family and start with the CSS variable, so a failed font load falls back to readable text.
- [ ] **Step 6: Run `yarn typecheck`, `yarn lint`, `yarn test`; commit** `feat(storefront): fonts, typography, store name`.

### Task 4: Core component restyle

**Files:**
- Modify: `apps/storefront/src/modules/common/components/ui/index.tsx` (`Button`, `Container`, `Badge`, `IconBadge`, `IconButton`, `Label`, `Input`, `Checkbox`, `RadioGroup`), `common/components/{input,native-select,checkbox,radio,divider}/index.tsx`
- Create: `apps/storefront/src/modules/common/components/ui/ui.test.tsx`

**Interfaces:**
- Produces: `Button` gains `variant: "primary" | "secondary" | "transparent" | "gold"` (existing three keep their meaning; `gold` is charcoal text on gold fill); all other props, `data-testid` and forwarded refs unchanged. Focus ring, 44px minimum height below 1024px, and `motion-reduce:transition-none` on every restyled control.

- [ ] **Step 1: Write `ui.test.tsx`** (jsdom): Button renders each of the four variants with distinct classes, `isLoading` disables it and shows "Loading...", `disabled` is respected, class `focus-visible:ring-gold-deep` present; Input shows its label and passes `data-testid` through; Checkbox toggles with the keyboard (Space).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Restyle** the listed components with the token utilities (no raw greys or `bg-black`), keeping prop APIs; replace hard-coded greys in the `common/components/*` files.
- [ ] **Step 4: Run `yarn test`, `yarn typecheck`, `yarn lint`; commit** `feat(storefront): restyle core components`.

### Task 5: Skeleton and toast

**Files:**
- Create: `common/components/skeleton/index.tsx`, `common/components/toast/index.tsx`, `common/components/toast/toast.test.tsx`, `common/components/skeleton/skeleton.test.tsx` (all under `apps/storefront/src/modules/`)
- Modify: `apps/storefront/src/app/layout.tsx` (mount `ToastProvider`), `apps/storefront/src/modules/common/components/ui/index.tsx` (remove the stale TODO comment)

**Interfaces:**
- Produces: `Skeleton({ className?: string })`, `SkeletonText({ lines?: number })` (default 3), `SkeletonImage({ ratio?: "1/1" | "4/5" | "16/9" })` (default `"4/5"`), all `aria-hidden` with `motion-safe:animate-pulse`; `ToastProvider({ children })`, `useToast(): { toast: (t: { title: string; description?: string; tone?: "info" | "success" | "error"; durationMs?: number }) => string; dismiss: (id: string) => void }`; the region is `role="region"` `aria-label="Notifications"`, each toast `role="status"` (tone `error` uses `role="alert"`); default `durationMs` 5000; hovering a toast pauses its timer.

- [ ] **Step 1: Write the tests**: toast appears with title, auto-dismisses after `durationMs` (fake timers), dismiss button removes only that toast, ten toasts render ten dismissible items and dismissing the fifth leaves nine, hover pauses the timer, `error` tone uses `role="alert"`, `useToast` outside the provider throws a clear Error; skeleton components are `aria-hidden` and `SkeletonText lines={5}` renders five bars.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** both primitives and mount `ToastProvider` in the root layout; the toast region is `fixed`, bottom on mobile and top-right on large screens, `max-h-screen overflow-y-auto`, animations use `motion-safe:` variants only.
- [ ] **Step 4: Run `yarn test`, `yarn typecheck`, `yarn lint`; commit** `feat(storefront): toast and skeleton primitives`.

### Task 6: Drawer and dropdown menu

**Files:**
- Create: `common/components/drawer/index.tsx`, `common/components/drawer/drawer.test.tsx`, `common/components/dropdown-menu/index.tsx`, `common/components/dropdown-menu/dropdown-menu.test.tsx` (under `apps/storefront/src/modules/`)
- Modify: `apps/storefront/src/modules/layout/components/side-menu/index.tsx`

**Interfaces:**
- Produces: `Drawer({ open: boolean; onClose: () => void; title: string; side?: "left" | "right"; children })` built on headless-ui `Dialog` (focus trap, Escape and overlay click call `onClose`, focus returns to the opener, `aria-modal`, the title is the dialog's accessible name, close button labelled "Close"); `DropdownMenu({ label: string; items: { label: string; onSelect?: () => void; href?: string; disabled?: boolean }[] })` built on headless-ui `Menu` (button with `aria-expanded`, arrow keys move, Enter or Space selects, Escape closes, disabled items skipped, `href` items render `LocalizedClientLink`).
- Consumes: Task 4 Button styles.

- [ ] **Step 1: Write the tests**: Drawer open shows a dialog named by `title`; Escape calls `onClose`; overlay click calls `onClose`; a drawer whose children have no focusable element still focuses the close button; focus returns to the opener after close; opener unmounted while open does not throw; DropdownMenu opens on click, ArrowDown then Enter fires the second item's `onSelect`, a disabled item is skipped, Escape closes and returns focus to the button.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** both; then rebuild `SideMenu` on `Drawer` (left side), keeping `data-testid="nav-menu-button"`, `side-menu-backdrop`, the same links and the language select.
- [ ] **Step 4: Run `yarn test`, `yarn typecheck`, `yarn lint`; commit** `feat(storefront): drawer and dropdown menu`.

### Task 7: Modal, product card, nav and footer

**Files:**
- Modify: `common/components/modal/index.tsx`, `products/components/product-preview/index.tsx`, `products/components/product-preview/price.tsx`, `products/components/thumbnail/index.tsx`, `layout/templates/nav/index.tsx`, `layout/templates/footer/index.tsx`, `layout/components/medusa-cta/index.tsx` (all under `apps/storefront/src/modules/`)
- Create: `products/components/product-preview/product-card.test.tsx`

**Interfaces:**
- Consumes: `getStoreName` (Task 3), tokens (Task 2), `Skeleton` (Task 5).
- Produces: a presentational `ProductCardView({ title: string; href: string; thumbnail?: string | null; priceLabel?: string | null; originalPriceLabel?: string | null })` exported from `product-preview/index.tsx` beside the existing async `ProductPreview` (which now maps its product to `ProductCardView` props); 4:5 image area; title clamped to two lines (`line-clamp-2`), price never wraps below the title; missing thumbnail renders the existing placeholder in the same 4:5 box.

- [ ] **Step 1: Write `product-card.test.tsx`**: a 300-character title renders inside `line-clamp-2` and the card root has `min-w-0`; no thumbnail renders the placeholder with the same ratio class as an image; an original price renders struck through with the sale price; the link points at `href`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `ProductCardView`, restyle `Thumbnail`, `Modal` (paper surface, line border, soft radius), nav (serif store name from `getStoreName()`, no "Medusa Store" text, ivory background, line border), footer (charcoal band with ivory text, store name and the year), and remove the Medusa call-to-action from the footer.
- [ ] **Step 4: Run `yarn test`, `yarn typecheck`, `yarn lint`; commit** `feat(storefront): luxury modal, product card, nav, footer`.

### Task 8: Preview page and design-system doc

**Files:**
- Create: `apps/storefront/src/app/[countryCode]/(main)/design-system/page.tsx`, `apps/storefront/src/app/[countryCode]/(main)/design-system/gate.ts`, `apps/storefront/src/app/[countryCode]/(main)/design-system/gate.test.ts`, `docs/storefront/DESIGN_SYSTEM.md`

**Interfaces:**
- Produces: `isPreviewEnabled(env?: { NODE_ENV?: string }): boolean` (false only when `NODE_ENV === "production"`); the page calls `notFound()` when it returns false. The page shows: colour swatches with their contrast ratios, the type scale, the four Button variants, Input, Checkbox, Badge, a `ProductCardView` with fixtures (normal, 300-character title, no thumbnail, on sale), Drawer and DropdownMenu triggers, toast triggers for each tone, and skeletons. Fixtures only, no data fetching.

- [ ] **Step 1: Write `gate.test.ts`**: enabled for `development` and `test`, disabled for `production`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the gate and page (client sections split into one `"use client"` component for the interactive demos), and write `docs/storefront/DESIGN_SYSTEM.md` (tokens table, components and props, accessibility rules, how to add a token, how to view `/design-system`).
- [ ] **Step 4: Run `yarn test`, `yarn typecheck`, `yarn lint`; commit** `feat(storefront): design system preview page and docs`.

### Task 9: Whole-phase verification

**Files:**
- Modify: none expected (fixes only, one commit per fix)

- [ ] **Step 1:** In `apps/storefront`: `yarn typecheck` (0 errors), `yarn lint` (no errors), `yarn test` (all pass); from the repo root `node --test deploy/*.test.mjs` (all pass).
- [ ] **Step 2:** Copy `apps/storefront` (excluding `node_modules`, `.next`) to `apps/sf-buildtest`, rename its package to `@dtc/sf-buildtest`, junction its `node_modules` to `apps/storefront/node_modules`, and run `npx next build` with `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_build NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://localhost:9000 NEXT_PUBLIC_DEFAULT_REGION=us NEXT_PUBLIC_BASE_URL=http://localhost:8000`. Expect exit 0 (needs internet for the fonts). Delete the junction with `[System.IO.Directory]::Delete` first, then the copy.
- [ ] **Step 3:** Scan the built `.next/static` for secret patterns (`sk_live`, `sk_test`, `whsec_`) and confirm none.
- [ ] **Step 4:** Start the storefront dev server from the worktree against the running backend (:9000), open `/design-system`, `/`, `/store`, a product page, `/cart` and `/checkout` at 390px and 1280px, check no console errors and no layout jump, and save screenshots to `docs/storefront/screenshots/` if a browser tool is available; otherwise report that this step was not possible.
- [ ] **Step 5:** Append the results (exact counts and what was not checked) to `docs/storefront/DESIGN_SYSTEM.md`; commit `docs(storefront): phase 2 verification`.
