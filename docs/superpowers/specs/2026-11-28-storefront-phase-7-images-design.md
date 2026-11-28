# Storefront Phase 7: Image Performance

Brief: `apps/storefront/CLAUDE.md`, Phase 7. Decision record: `docs/storefront/IMPLEMENTATION_PLAN.md` item 5 (images and CDN).

## Why (measured on the current code)

- `images.unoptimized: true` in `apps/storefront/next.config.js`: no resizing, no AVIF/WebP anywhere.
- The catalogue is 3,829 JPEG originals in `apps/backend/static/perfume-center/` (1.6 GB, 421 KB on average, up to 1800x1678 px), served by the backend at `/static`.
- Every product card, the search overlay (8 rows) and the gallery download full originals.
- Product records store absolute URLs such as `http://localhost:9000/static/perfume-center/1795717208755-AI0088421.jpg`. In production those URLs are only right if the backend knows its public address; rewriting 3,829 records is not wanted.
- `next/image` is used in 4 components (hero frame, thumbnail, image gallery, search hit) with `sizes`, aspect-ratio boxes and priority on the hero. Three homepage components (`category-grid/tile.tsx`, `editorial/index.tsx`, `promo-banners/index.tsx`) still use a plain `<img>`: no `sizes`, no lazy loading, no dimensions.
- No cache headers for images in `deploy/Caddyfile`; no CDN notes.

## Goal

Pages load the smallest image that looks right at the visitor's width, in AVIF or WebP, cached for a long time, without layout shift, and the CDN set-up is documented. Success is the brief's acceptance list, measured: responsive delivery, no oversized thumbnails, no major layout shift, CDN configuration documented.

## Decisions (owner: "take all recommended")

- **Optimiser:** turn Next's built-in image optimiser on. No new service; originals stay where they are. `sharp` is already in the repo's `node_modules`; declare it in the storefront `package.json` so the Docker image has it.
- **Loader:** a custom `images.loaderFile` that emits Next's `/_next/image?url=&w=&q=` URL after rewriting the origin of any `/static/...` URL to a configurable image origin: `NEXT_PUBLIC_IMAGE_ORIGIN`, default `NEXT_PUBLIC_MEDUSA_BACKEND_URL`. Stored `localhost` URLs therefore work in production. The optimiser only fetches hosts that match `remotePatterns`, built from the same origin plus the S3 hosts already there. Not a secret; `NEXT_PUBLIC_*`.
- **CDN:** the design works with or without a CDN. Cloudflare in front of the store host is the documented default (cache rules for `/_next/image*`, `/_next/static/*`), but no account is configured or required. Cloudflare Images (paid, moves the originals) is not used.
- **Blur placeholders:** a small paper-coloured placeholder for now. A per-image blur (LQIP) needs a one-time job over 3,829 images and is out of scope; the docs say so.

## Design

1. **next.config.js.** `images.unoptimized` removed; `formats: ["image/avif", "image/webp"]`; `deviceSizes` and `imageSizes` trimmed to the breakpoints the design uses; `minimumCacheTTL` of 31 days; `qualities` limited (for example 60 and 75); `loaderFile: ./src/lib/image-loader.ts`; `remotePatterns` from env. Local dev needs the optimiser to fetch from `localhost:9000`, which Next may refuse as a private address: the plan's first task checks the Next 15.5 behaviour and adds an explicit, dev-only opt-in (`IMAGE_ALLOW_LOCAL_ORIGIN`) if needed, never on by default in production.
2. **Loader and helpers.** `src/lib/image-loader.ts` (pure: origin rewrite, width, quality clamp, rejects non-http(s)) and `src/lib/image-origin.ts` (reads the env, builds `remotePatterns`), both unit tested.
3. **Components.** The three homepage `<img>` become `next/image` with a fixed aspect-ratio box, real `sizes` for their layout and lazy loading; the hero keeps `priority`; the product gallery keeps priority only on the first image (currently the first three); search hits and listing thumbnails keep `sizes` matched to their column widths. Every image sits in a box with an intrinsic aspect ratio, so nothing shifts when it loads. Images whose host is not allowed fall back to the placeholder instead of breaking the page (the hero already has an `onError` fallback).
4. **Cache headers and deploy.** `deploy/Caddyfile`: `/_next/static/*` immutable for a year; `/_next/image*` and the backend `/static/*` long-lived `Cache-Control` set by the origin or by Caddy; compression on. `deploy/docker-compose.yml`: a named volume for the optimiser cache (`.next/cache/images`) owned by the `node` user so resized images survive restarts. Compose tests updated. The Docker build itself cannot be run on the dev machine and is reported as not verified.
5. **Measurement.** Before and after, in real Chrome on the production build with the 3,431-product catalogue: transferred image bytes, image count and largest image for the home page, the `/store` listing, a product page and the search overlay (8 rows), plus layout shift (CLS) from the browser's layout-shift entries. Numbers go in the docs, whatever they are.
6. **Docs.** `docs/storefront/IMAGES.md`: what was changed and why, env variables, the loader, cache headers, Cloudflare cache rules and how to purge, how to add an image host, how to verify, the measured results and a "Not verified" list (Docker image, Cloudflare in front, real devices and slow networks).

## Error handling

- A source URL on a disallowed host or a failed upstream fetch: the component shows the existing placeholder (no broken-image icon, no layout shift).
- Optimiser errors never reach checkout or text content: images are decorative to the flow.
- A missing `NEXT_PUBLIC_IMAGE_ORIGIN` falls back to `NEXT_PUBLIC_MEDUSA_BACKEND_URL`; if both are absent the loader returns the source unchanged.

## Testing and acceptance

- Unit: loader (origin rewrite, width/quality clamp, bad inputs), `remotePatterns` builder, the three converted components (render with `next/image`, aspect box, `sizes`, lazy, no `priority`), gallery priority rule.
- Config: a test that loads `next.config.js` and asserts `unoptimized` is not set, formats, TTL and that production has no local-origin opt-in.
- Deploy: compose and Caddy tests updated; the existing deploy node tests pass.
- Live: `/_next/image` returns AVIF or WebP at the requested width with the long cache header; a thumbnail request is under 40 KB for a 280 px slot; CLS under 0.1 on the four pages; the baseline-vs-after table is recorded.

## Out of scope

Per-image blur placeholders, moving originals to S3 or R2, rewriting the stored URLs, Cloudflare account set-up, video, art-directed crops, AVIF generation at import time.
