# Storefront Phase 7: Image Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve every storefront image through Next's optimiser (AVIF/WebP at the requested width) behind long cache headers, with no layout shift and the CDN set-up documented.

**Architecture:** `images.unoptimized` is removed and a custom `loaderFile` rewrites the origin of stored `/static/...` URLs to `NEXT_PUBLIC_IMAGE_ORIGIN` (default `NEXT_PUBLIC_MEDUSA_BACKEND_URL`) and emits Next's `/_next/image` URL. The three homepage `<img>` become `next/image` in fixed-ratio boxes. Caddy and compose add cache headers and a persistent optimiser cache volume. Cloudflare in front is documented, not configured.

**Tech Stack:** Next 15.5 (`next/image`, `images.loaderFile`), `sharp`, Vitest + Testing Library, Caddy, Docker compose.

**Spec:** `docs/superpowers/specs/2026-11-28-storefront-phase-7-images-design.md`

## Global Constraints

- Storefront tests: Vitest in `apps/storefront`, files beside the code (`*.test.ts(x)`); run `npx vitest run <paths>`; `npx tsc --noEmit` must stay at 0 errors; lint with `ESLINT_USE_FLAT_CONFIG=false npx eslint <files>` (exit 0); `next lint` errors fail `next build`.
- `next build` runs from a sibling copy outside the worktree (copy `apps/storefront` without `node_modules`/`.next`, rename the package, junction `node_modules` to the main checkout's root and storefront folders, write `package.json` without BOM). Remove the junctions with `[IO.Directory]::Delete(path)` before any recursive delete.
- Tailwind 3 design tokens only (`ivory paper charcoal warm-grey line line-strong gold gold-deep`, `font-serif`); no alpha on CSS-var colours.
- `NEXT_PUBLIC_*` values are public by nature and inlined at build time: `NEXT_PUBLIC_IMAGE_ORIGIN` is an origin, never a secret.
- No raw `<img>` in storefront components after Task 3 (the hero and every product image already use `next/image`).
- `remotePatterns` must never be a wildcard that allows any host: only the image origin host, `localhost`, and the S3 hosts already present.
- Dev machine has no Docker: Docker/compose steps are validated by the deploy node tests (`node --test deploy/*.test.mjs`) and reported as not run.

## Review Focus

1. Odd `src` values reach the loader: relative paths (`/images/x.jpg`), protocol-relative URLs, `data:` and `blob:` URIs, URLs with spaces or non-ASCII characters, empty string, a width of 0 or a huge width. Expected: valid output or the source returned unchanged, never an exception, never a URL the optimiser could be abused with. Task 1.
2. An attacker-controlled `src` on a disallowed host must not be fetched by the optimiser (SSRF): `remotePatterns` stays an allow-list. Task 2.
3. The optimiser cache directory must be writable by the `node` user in the container, or resized images are silently never cached. Task 4.
4. A failing image (404, disallowed host, timeout) must leave the box and the page layout intact and show the placeholder. Task 3.
5. Layout shift: every image has an intrinsic aspect ratio box; the hero is `priority`, only the first gallery image is `priority`; lazy images below the fold. Task 3.

---

## Baseline (controller, before Task 1)

Measure on the current production build with the real catalogue and record in the ledger: transferred image bytes, image request count and largest image for the home page, `/us/store`, one product page and the search overlay (type `latafa`, 8 rows), plus CLS from `PerformanceObserver` layout-shift entries. Method: real Chrome via `playwright-core` driving `next start`. The same script measures again in Task 5.

### Task 1: Origin and loader libraries (pure) and the sharp dependency

**Files:**
- Create: `apps/storefront/src/lib/image-origin.ts`, `apps/storefront/src/lib/image-loader.ts`
- Test: `apps/storefront/src/lib/image-origin.test.ts`, `apps/storefront/src/lib/image-loader.test.ts`
- Modify: `apps/storefront/package.json` (declare `sharp` at the version already resolved in the repo's `node_modules`, exact)

**Interfaces:**
- Produces: `resolveImageOrigin(env?: Record<string, string | undefined>): string | null` (trimmed `NEXT_PUBLIC_IMAGE_ORIGIN`, else `NEXT_PUBLIC_MEDUSA_BACKEND_URL`; http(s) only; returns the origin without trailing slash or path; `null` when absent or invalid); `buildRemotePatterns(env?): RemotePattern[]` (the image origin host, `localhost` http, and the two S3 patterns already in `next.config.js`, deduplicated); `rewriteImageSrc(src: string, origin: string | null): string` (only an absolute http(s) URL whose path starts with `/static/` is re-hosted onto `origin`, query kept; everything else, including relative, protocol-relative, `data:`, `blob:`, empty, is returned unchanged); default export `imageLoader({ src, width, quality }): string` returning `/_next/image?url=<encodeURIComponent(rewritten src)>&w=<width>&q=<quality ?? 75>`, with `width` clamped to 16..3840 and an integer, `quality` clamped to 1..100 and an integer, and a non-http(s)/relative `src` returned as `/_next/image?url=...` only when it starts with `/`, otherwise returned unchanged.

- [ ] **Step 1: Write failing tests.** `resolveImageOrigin`: image origin wins over backend URL; backend URL used otherwise; `"https://img.example.com/x"` returns `"https://img.example.com"`; `"ftp://x"`, `""`, `"not a url"` and missing both return `null`. `buildRemotePatterns`: includes `{protocol:"https",hostname:"img.example.com"}`, localhost, both S3 patterns, no duplicates, never a `"**"` hostname. `rewriteImageSrc`: `http://localhost:9000/static/perfume-center/a.jpg` with origin `https://admin.example.com` gives `https://admin.example.com/static/perfume-center/a.jpg`; query kept; a non-`/static/` path on another host unchanged; `/relative.jpg`, `//cdn.x/a.jpg`, `data:image/png;base64,AAAA`, `blob:x`, `` unchanged; spaces and non-ASCII in the path survive and end up percent-encoded once. Loader: width 0 becomes 16, 99999 becomes 3840, 280.7 becomes 281; quality undefined 75, 0 becomes 1, 500 becomes 100; the output starts with `/_next/image?url=`; a `data:` src is returned unchanged and never wrapped.
- [ ] **Step 2:** run, see them fail. **Step 3:** implement the three exports. **Step 4:** tests, `tsc`, eslint green. **Step 5: Commit** `feat(storefront): image origin and loader libraries`.

### Task 2: next.config.js, env and the local-origin question

**Files:**
- Modify: `apps/storefront/next.config.js`, `apps/storefront/.env.template`, `apps/storefront/check-env-variables.js` only if it needs the new variable listed as optional, `deploy/required-env.json` and `deploy/.env.example` (optional `NEXT_PUBLIC_IMAGE_ORIGIN`), `deploy/storefront.Dockerfile` (build ARG/ENV `NEXT_PUBLIC_IMAGE_ORIGIN`), `deploy/docker-compose.yml` (build arg passthrough)
- Create: `apps/storefront/next.config.test.ts` (or `.mjs` if the config is CommonJS and the test must `require` it; follow the repo's Vitest setup)

**Interfaces:**
- Consumes: `buildRemotePatterns` from Task 1 (the CommonJS config cannot import TypeScript: expose the pattern builder through a small `apps/storefront/image-config.js` CommonJS module that Task 1's TypeScript also reuses, OR duplicate the few lines in `.js` with a unit test asserting both agree — choose the smaller; state the choice).
- Produces: images config `{ formats: ["image/avif","image/webp"], deviceSizes, imageSizes, minimumCacheTTL: 2678400, qualities: [60, 75], loaderFile: "./src/lib/image-loader.ts", remotePatterns }` with no `unoptimized`.

- [ ] **Step 1: Check the Next 15.5 behaviour first.** Read `node_modules/next` image-optimizer code for the private-address block (`dangerouslyAllowLocalIP` or similar). Write the finding in the task report. If the optimiser refuses `localhost`, add an env-gated dev opt-in `IMAGE_ALLOW_LOCAL_ORIGIN=true` (server-only, never set in compose/Docker, documented in `.env.template`); if Next does not block it, add nothing.
- [ ] **Step 2: Write a failing config test:** `unoptimized` is undefined; `formats` are avif then webp; `minimumCacheTTL` is 2678400; `loaderFile` is set; with `NODE_ENV=production` and no opt-in env the local-origin flag is absent; `remotePatterns` contains the origin host when `NEXT_PUBLIC_IMAGE_ORIGIN=https://img.example.com` and never a `"**"` hostname.
- [ ] **Step 3:** implement; choose `deviceSizes`/`imageSizes` from the Tailwind breakpoints in `tailwind.config.js` (document the mapping in a comment). **Step 4:** tests, `tsc`, eslint. **Step 5: Commit** `feat(storefront): enable the image optimiser with an origin-rewriting loader`.
- [ ] **Step 6 (verify with the real server):** from a sibling copy, `next build` then `next start`; request one existing product image through `/_next/image?url=http%3A%2F%2Flocalhost%3A9000%2Fstatic%2F...&w=384&q=75` with `Accept: image/avif,image/webp` and record status, content-type and bytes in the report. If it fails on the local-origin rule, fix with the opt-in and re-run.

### Task 3: Components, gallery priority and fixed-ratio boxes

**Files:**
- Modify: `apps/storefront/src/modules/home/components/category-grid/tile.tsx`, `editorial/index.tsx`, `promo-banners/index.tsx`, `apps/storefront/src/modules/products/components/image-gallery/index.tsx`, and review (adjust `sizes` only if wrong) `products/components/thumbnail/index.tsx` and `layout/components/search/option.tsx`/`hit.tsx`
- Create: a small `apps/storefront/src/modules/common/components/safe-image/index.tsx` (client component wrapping `next/image` with an `onError` state that renders the existing `PlaceholderImage`) used by the three converted components
- Test: beside each converted component, plus `safe-image/index.test.tsx` and `image-gallery/index.test.tsx`

**Interfaces:**
- Consumes: the custom loader is applied globally through `images.loaderFile`; components just render `next/image`.
- Produces: `SafeImage` props `{ src: string; alt: string; sizes: string; className?: string; priority?: boolean }` rendering `fill` inside the caller's aspect-ratio box and a placeholder on error.

- [ ] **Step 1: Write failing tests.** Tile: with an `imageUrl` renders an `img` with `loading="lazy"` (no `priority`) and a `srcset` containing `/_next/image`; without `imageUrl` renders no image; `alt` is empty for the decorative tile. Editorial: `aspect-[4/3]` box, `sizes` for a half-width column (`(min-width: 1024px) 50vw, 100vw` or the layout's real value), lazy. Promo: `aspect-[16/9]` box, same checks. `SafeImage`: on `error` the `img` is replaced by the placeholder and the box keeps its class (no collapse). Gallery: only index 0 has `priority` (the other images lazy); alt text unchanged.
- [ ] **Step 2:** fail. **Step 3:** implement; each converted box gets `relative overflow-hidden` plus its existing aspect class so nothing shifts; `sizes` values must match the real rendered width of each slot (grid columns in the file). **Step 4:** run the component tests, the whole storefront Vitest suite, `tsc`, eslint. **Step 5: Commit** `feat(storefront): optimised images on the homepage and a single priority gallery image`.

### Task 4: Cache headers, compose volume, Dockerfile

**Files:**
- Modify: `deploy/Caddyfile`, `deploy/docker-compose.yml`, `deploy/storefront.Dockerfile`, `deploy/compose.test.mjs` (and any Caddy test added next to it)

**Interfaces:**
- Produces: Caddy `{$STORE_HOST}` block with `encode zstd gzip` and `@static path /_next/static/*` → `header Cache-Control "public, max-age=31536000, immutable"`, `@optimised path /_next/image*` → `header Cache-Control "public, max-age=2678400, stale-while-revalidate=86400"` (only when the upstream did not set one); `{$ADMIN_HOST}` `/static/*` → `header Cache-Control "public, max-age=2678400"`; compose named volume `storefront-image-cache` mounted at `/app/apps/storefront/.next/cache` on the storefront service; the Dockerfile creates `.next/cache` owned by `node` before `USER node` so the volume inherits ownership.

- [ ] **Step 1: Write failing deploy tests** (extend `compose.test.mjs`): the storefront service mounts `storefront-image-cache` at that path; the volume is declared; the Caddyfile contains the three header rules and `encode`; the Dockerfile creates the cache dir with `node` ownership before `USER node`; existing literal-allowlist and memory-floor tests still pass.
- [ ] **Step 2:** fail. **Step 3:** implement. **Step 4:** `node --test deploy/*.test.mjs` green (report the count). **Step 5: Commit** `feat(deploy): long-lived cache headers for images and a persistent optimiser cache`.

### Task 5: Measure, document, close the audit item

**Files:**
- Create: `docs/storefront/IMAGES.md`
- Modify: `docs/storefront/IMPLEMENTATION_PLAN.md` (Phase 7 done, decision item 5 settled), `docs/storefront/TECH_STACK.md` (Images row), `docs/storefront/PROJECT_AUDIT.md` (mark S6 resolved with a pointer), the root/deploy env docs if a variable row is missing

- [ ] **Step 1 (controller):** rebuild from a sibling copy, restart both apps, rerun the baseline script on the same four pages; record bytes, request counts, largest image and CLS before and after, plus the `/_next/image` response header check (content-type AVIF/WebP, `Cache-Control`), a thumbnail request size for a 280 px slot, and the result of a request for a disallowed host (must not be fetched). Run a real-Chrome pass of the four pages for visible breakage (screenshots).
- [ ] **Step 2:** write `IMAGES.md`: what changed and why; env variables (`NEXT_PUBLIC_IMAGE_ORIGIN`, `IMAGE_ALLOW_LOCAL_ORIGIN` if added); loader behaviour and the origin rewrite; cache headers; Cloudflare cache rules (cache `/_next/image*` and `/_next/static/*` by URL, respect origin headers, how to purge); how to add an image host; how to verify; the measured before/after table (real numbers only); "Not verified": Docker image build and the cache volume ownership, Cloudflare in front, real devices and slow networks, blur placeholders out of scope.
- [ ] **Step 3:** update the three docs; **Step 4: Commit** `docs(storefront): image performance guide and measured results`.
