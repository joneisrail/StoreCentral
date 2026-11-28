# Storefront Images

How product and homepage images are served by the storefront (`apps/storefront`) after Phase 7, why, and how to check it. This describes only what is implemented.

## What changed and why

Measured before Phase 7 on a production build of master (Chrome, 1280x800 unless noted):

- The catalogue has 3,829 original images averaging 421 KB, all JPEG, up to 1800 px wide.
- `images.unoptimized: true` was set, so the browser downloaded the originals as they are, on phones too.
- Product records store image URLs with the host they were uploaded under (`http://localhost:9000/static/...` in local data). Those URLs are wrong anywhere else.
- A listing page loaded 3.2 MB of images, the search overlay 7.9 MB, and `/us/store` had a layout shift of 0.47 (0.56 at 390 px). The shift turned out not to come from the images (see Layout shift).

What Phase 7 does:

- Turns the Next.js image optimiser on (AVIF, then WebP, resized per slot).
- Adds a custom loader that rewrites stored `/static/...` URLs onto one configured image origin.
- Gives every image slot an aspect-ratio box and an explicit `sizes` string.
- Reserves space under the listing so the footer does not jump.
- Sets cache rules for the proxy and a persistent cache volume for resized images.

## Design

### Optimiser and loader

`apps/storefront/next.config.js`:

| Setting | Value | Why |
| --- | --- | --- |
| `formats` | `image/avif`, `image/webp` | AVIF first, WebP for browsers without it |
| `loaderFile` | `./src/lib/image-loader.ts` | Rewrites the source URL, then builds `/_next/image?url=...&w=...&q=...`, or returns the URL unchanged when the optimiser does not serve its host |
| `loader` | not set (default) | `loaderFile` only works with the default `loader` value. Any other value makes `/_next/image` answer 404 |
| `qualities` | `[60, 75]` | Any other `quality` prop is answered with 400. 60 for card thumbnails, 75 for the gallery and the default |
| `deviceSizes` | `360, 480, 640, 768, 1024, 1280, 1600` | Follow the Tailwind screens (320 / 512 / 640 / 768 / 1024 / 1280 / 1440 / 1680). Stops at 1600 because the originals are at most 1800 px wide |
| `imageSizes` | `64, 96, 128, 180, 256, 384` | Slots narrower than a screen: search rows, small thumbnails, cards in multi-column grids |
| `minimumCacheTTL` | `2678400` (31 days) | Resized images are keyed by URL, width, quality and format |
| `maximumDiskCacheSize` | `2000000000` (2 GB) | Caps the resized-image cache on disk, least recently used evicted. Next's default is half the free disk space |
| `experimental.imgOptConcurrency` | `1` | One sharp job at a time; the container has 512 MB (see Memory and operations) |
| `experimental.imgOptMaxInputPixels` | `25000000` | Source images above 25 MP are refused (default about 268 MP); the originals are about 3 MP |

The three cap options were checked against Next 15.5.24 before use: `images.maximumDiskCacheSize` in `next/dist/server/config-schema.js` and `next/dist/server/image-optimizer.js` (passed to the disk LRU, which otherwise uses half of the free space reported by `statfs`), and `experimental.imgOptConcurrency` / `experimental.imgOptMaxInputPixels` in `config-shared.js` and `config-schema.js` (passed to sharp as `concurrency` and `limitInputPixels`).

`sizes` drives the choice of width. `next/image` builds a `srcset` from `deviceSizes` and `imageSizes` and the browser picks from it using the `sizes` string and the device pixel ratio. A `sizes` string that is too wide makes the browser pick a larger file than the slot needs, so every call site states the slot's real width. The `width` and `quality` the loader receives are clamped (width 16 to 3840, quality 1 to 100, non-numbers fall back to 16 and 75), and the optimiser then rejects any width not in the two size lists and any quality not in `qualities`.

### The loader and the image origin

`apps/storefront/src/lib/image-loader.ts` and `apps/storefront/src/lib/image-origin.ts`.

The image origin is `NEXT_PUBLIC_IMAGE_ORIGIN`, defaulting to `NEXT_PUBLIC_MEDUSA_BACKEND_URL`. The loader re-hosts a source URL onto that origin only when the URL path starts with `/static/` and its host is one of: `localhost`, `127.0.0.1`, `[::1]`, the image-origin host, or the backend-URL host. A third-party or S3 `/static/` URL is left untouched. Credentials in the URL are cleared. Root-relative sources such as `/hero.jpg` are wrapped into `/_next/image`. Anything that is neither `http(s)://` nor root-relative (a `data:` URL, `//host/...`, `/\host`) is returned as it is.

After the rewrite, the loader wraps an absolute URL into `/_next/image` only when the optimiser serves its host: it builds the same pattern list as `remotePatterns` (`buildRemotePatterns`) and matches protocol, hostname and, when the pattern pins one, port. Any other URL is returned unchanged and the browser loads it directly, unoptimised, instead of receiving a 400 from `/_next/image`. See Channel-imported and third-party images.

The same origin feeds `remotePatterns`.

### Security: what the optimiser may fetch

`remotePatterns` is an allow-list. A `/_next/image` request for a host not on it is answered with 400 before any fetch. The list is:

- The image origin, protocol and host, with its port pinned when it has one.
- The Medusa Cloud S3 pattern when `MEDUSA_CLOUD_S3_HOSTNAME` and `MEDUSA_CLOUD_S3_PATHNAME` are set (`next.config.js` only).
- `http://localhost` on any port, but only when `NODE_ENV` is not `production`.

There are no generic S3 wildcards. `*.s3.*.amazonaws.com` and `*.s3.amazonaws.com` were removed: Next matches hostnames with picomatch, whose `*` also matches dots, so they admitted any bucket, including one an attacker controls, and made the optimiser an open resizing proxy running under a 512 MB limit. A bucket is allowed only as the image origin or as the Medusa Cloud bucket.

Next.js 15.5 has no private-address block: the optimiser fetches whatever a matching pattern allows, including addresses on the container itself. That is why the any-port `localhost` pattern exists only outside production. In production, localhost is allowed only as the configured origin, pinned to that origin's port (a local origin on the default port gets `port: ""`, because a missing `port` would match every port). Probed after the fix: `localhost:9000` (the configured origin) answered 200, `localhost:8000` answered 400.

`NEXT_PUBLIC_IMAGE_ORIGIN` is public: it is inlined into the browser bundle, so put only a public image origin in it. `remotePatterns` are serialised into the build, so changing the variable needs a rebuild of the storefront image, not just a restart. `deploy/docker-compose.yml` passes it as a build arg and as a runtime env, and `deploy/storefront.Dockerfile` declares the `ARG` and `ENV`.

`next.config.js` is CommonJS and cannot import the TypeScript module, so the pattern builder exists twice (`next.config.js` and `buildRemotePatterns` in `src/lib/image-origin.ts`). `apps/storefront/next.config.test.ts` asserts both give the same list for ten environments, in production and in development.

### Adding an image host

1. If the images live on the Medusa backend under `/static/`, nothing to add: set `NEXT_PUBLIC_IMAGE_ORIGIN` to the public host that serves them (for example the admin host).
2. For any other host, add a `remotePatterns` entry in `next.config.js`, with protocol, hostname and (if not 443/80) port, and mirror it in `buildRemotePatterns` in `src/lib/image-origin.ts` (the agreement test fails if they differ). Use the narrowest hostname you can; never `**`.
3. Rebuild the storefront image.

### Channel-imported and third-party images

Not every image URL points at the backend. Products imported from a sales channel keep the channel's image URLs (Shopify imports point at `cdn.shopify.com`, WooCommerce imports at the shop's own host), and a category's `metadata.image_url` accepts any `https://` URL. The optimiser does not serve those hosts, so `/_next/image` would answer 400 for them.

The loader therefore returns such a URL unchanged: the browser loads the original from the channel's host, unoptimised (full size, original format). Nothing breaks, but those images are as heavy as before Phase 7. To optimise them, either:

- import the images into the backend file store (then they live under `/static/` on the image origin), or
- set `NEXT_PUBLIC_IMAGE_ORIGIN` to that host, if all images come from one host (there is one image origin), and rebuild.

Medusa Cloud S3: `MEDUSA_CLOUD_S3_HOSTNAME` is not a `NEXT_PUBLIC_` variable, so the browser bundle cannot see it and the loader does not know that bucket. Its images load directly, unoptimised, unless `NEXT_PUBLIC_IMAGE_ORIGIN` is set to that bucket host. (Reading it on the server only would make the server and the browser render different `src` values.)

In development, Next logs a warning that the loader "does not implement width" for an image the loader passes through. That is expected for those images; production builds do not log it.

If an image still fails (a broken URL, a host that is down), `SafeImage` shows the placeholder in the slot.

## Memory and operations

- sharp (libvips) allocates pixel buffers in native memory, outside the V8 heap, so `NODE_OPTIONS=--max-old-space-size=384` does not cap it. Heap plus sharp must stay under the container's `mem_limit: 512m`. `imgOptConcurrency: 1` and `imgOptMaxInputPixels: 25000000` bound one resize at a time to a bounded source size. AVIF encoding is the most expensive step.
- After a deploy with an empty cache, the first request for each image, width and format pays the encode in CPU time; the first page views are slower until the cache warms. A redeploy keeps the `storefront-image-cache` volume, so a normal release does not start cold.
- The disk cache is capped at 2 GB (`maximumDiskCacheSize`), least recently used entries evicted.
- To clear it: stop the storefront, `docker volume rm <project>_storefront-image-cache`, start it again (Docker recreates the volume owned by `node` from the image).
- `docs/ops/memory.md` has the same notes next to the container limits.

## Components

- `SafeImage` (`src/modules/common/components/safe-image/index.tsx`): a client component that renders `next/image` in `fill` mode inside a box the caller owns. If the image fails to load (including a 400 from `/_next/image`), it shows the paper-coloured placeholder icon in the same box, so nothing shifts. The error state is keyed by `src`, so a new `src` tries again. `quality` is typed `60 | 75`.
- Hero (`src/modules/home/components/hero/hero-frame.tsx`): the hero image is the one `priority` image on the homepage; `priority`, `sizes="100vw"`, in a section with a fixed minimum height.
- Product gallery (`src/modules/products/components/image-gallery/index.tsx`): `SafeImage`, `priority` on image index 0 only, `sizes="(min-width: 1024px) 50vw, 100vw"`.
- `Thumbnail` (`src/modules/products/components/thumbnail/index.tsx`) and the search hit thumbnail (`src/modules/layout/components/search/hit.tsx`) also render through `SafeImage` (quality 60 for `Thumbnail`), so a failing product image shows the placeholder.
- Homepage tiles, editorial and promo banners use `SafeImage` inside fixed aspect-ratio boxes. Their `sizes`:
  - category tile: `(min-width: 1440px) 336px, (min-width: 1024px) 25vw, 50vw`
  - editorial: `(min-width: 1440px) 680px, (min-width: 1024px) 50vw, 100vw`
  - promo banner: the 684 px variant of the editorial string
- Product cards (`product-preview`): grid `(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, 50vw`; list `(min-width: 640px) 40vw, 40vw`.
- Small-slot `Thumbnail` call sites, each with an explicit `sizes` because the default (about 800 px) would request a file far larger than the slot:

| Call site | File | `sizes` |
| --- | --- | --- |
| Cart item | `src/modules/cart/components/item/index.tsx` | `96px` |
| Cart dropdown | `src/modules/layout/components/cart-dropdown/index.tsx` | `96px` |
| Order item | `src/modules/order/components/item/index.tsx` | `64px` |
| Account order card | `src/modules/account/components/order-card/index.tsx` | `(min-width: 1024px) 25vw, 50vw` |
| Search hit | `src/modules/layout/components/search/hit.tsx` | `44px` |

A new call site of `Thumbnail` or `next/image` should state its own `sizes` and, if it passes `quality`, use 60 or 75.

Per-image blur placeholders were not built: a slot shows a plain paper-coloured box until the image arrives.

## Layout shift

The images did not cause the `/us/store` shift. In Chrome, with `PerformanceObserver` layout-shift entries, the single shift was the footer moving down when the listing filled in. The listing (react-instantsearch) renders nothing on the server, so the HTML has the footer directly under the page heading (footer at y 192 while the hits are empty) and the footer jumps when the client tree mounts.

The fix is `ReserveResultsSpace` (`src/modules/store/components/reserve-results-space.tsx`): a `min-h-[100svh]` wrapper around the `<InstantSearch>` provider, used by the store template and the search page. It sits outside InstantSearch because it must be in the server HTML, and it is permanent, so a short or empty result set cannot collapse it.

Two earlier designs were abandoned. The unit tests passed for both, and real Chrome showed the shifts:

1. Fixed `min-h` values per breakpoint on a wrapper (c32e063877), dropped once results settled. Measured CLS was 0.4875 on desktop and 0.5768 at 390 px: the reserve was placed where react-instantsearch children are not server-rendered, so it was not in the HTML.
2. The same estimated reserve moved outside InstantSearch (044e7d77b8), still dropped on settle. Short result sets made the footer jump back up when the reserve was removed: CLS 0.23 to 0.42.

The final design is c54f590cec. Heights were estimates in both earlier designs; the permanent viewport-high minimum needs none.

The trade-off: a result set shorter than the viewport leaves empty space above the footer.

## Cache headers and CDN

Next already sends the right headers, so Caddy adds none for the storefront:

- `/_next/static/*`: `public, max-age=31536000, immutable`.
- `/_next/image*`: `public, max-age=2678400, must-revalidate` (measured on the live optimiser).

In `deploy/Caddyfile` a `header` directive runs before `reverse_proxy` in Caddy's handler chain, so a `header Cache-Control ...` rule on a proxied path would not see or replace the upstream header and could produce a duplicate or the wrong one. The store host therefore has only `encode zstd gzip`.

The admin host serves product images from the Medusa backend, which sends `Cache-Control: public, max-age=0` on `/static/*`. Caddy overrides it for that path inside the proxy, with `header_down`, which operates on the upstream response:

```
@productimages {
	path /static/*
	not path /static/private-* /static/*/private-*
}
handle @productimages {
	reverse_proxy backend:9000 {
		header_down Cache-Control "public, max-age=2678400"
	}
}
handle {
	reverse_proxy backend:9000
}
```

Image file names carry a timestamp, so a URL never changes content. Medusa's local file provider (`@medusajs/file-local`) also writes private files, such as product export and import CSVs, into the same `static` folder, named `private-<timestamp>-<name>` (under an upload subfolder when the file name has one). The matcher excludes them, so they fall into the default `handle` and keep the backend's `max-age=0`. `/static/*/private-*` covers one subfolder level (a `*` in the middle of a Caddy path pattern does not cross `/`); a deeper private path would get the long cache header. Every other file under `/static/` gets it.

### Image cache volume

The optimiser writes resized images to `<distDir>/cache/images` (`ImageOptimizerCache` in `next/dist/server/image-optimizer.js`); in the standalone image that is `/app/apps/storefront/.next/cache/images`. `deploy/docker-compose.yml` mounts the named volume `storefront-image-cache` there, and only there, so resized images survive restarts and redeploys. `deploy/storefront.Dockerfile` creates that directory owned by `node` before `USER node`, and Docker initialises an empty named volume from the image directory's ownership. It also chowns the parent `.next/cache` to `node` (non-recursively, no volume on it) so Next's own data cache (`.next/cache/fetch-cache`) can be written at runtime.

The volume does not cover all of `.next/cache`: that directory also holds Next's data cache (`fetch-cache`). On a volume it would be kept across redeploys, so a new release could serve old products and prices, and it has no size cap. Each new image starts with an empty data cache.

A volume that was mounted on `.next/cache` before this change holds `images/` and `fetch-cache/` at its root; at the new mount point both would sit one level too deep and only waste space. Remove it once (`docker volume rm <project>_storefront-image-cache`).

A volume that already exists and was created root-owned stays root-owned, and the optimiser (running as `node`) then cannot write to it. Either remove it (`docker volume rm <project>_storefront-image-cache`, which discards cached images) or chown it once.

### Cloudflare in front (documentation only)

No Cloudflare account is configured and nothing in the repo depends on it. If you put it in front of the storefront and admin hosts:

- `/_next/static/*` on the store host can get a cache rule, eligible for cache, with the edge TTL set to respect the origin's `Cache-Control`.
- Do not add an edge cache rule for `/_next/image*` unless the plan can vary the cache key on the `Accept` header. The optimiser picks AVIF or WebP from `Accept` and answers with `Vary: Accept`, which Cloudflare does not honour on standard plans; an edge-cached AVIF could then be served to a browser that cannot decode it. Without a rule those responses go to the optimiser's own disk cache. This was not tested.
- `/static/*` on the admin host can be cached, respecting the origin header set by the rule above, but never edge-cache `/static/private-*` (or `/static/*/private-*`): those are Medusa's private files (export and import CSVs). Do not cache the rest of the admin host.
- The optimiser fetches source images from the image origin over the public network, through Cloudflare and Caddy, as a server-side request without a browser. A Bot Fight Mode or WAF challenge on that request would make every optimised image fail; exempt the origin's `/static/*` from challenges.
- To purge after replacing an image under the same URL: purge by URL for that `/static/...` path and for the `/_next/image` URLs built from it, or purge everything. New uploads get new, timestamped names and need no purge.
- Resized images are also cached in the storefront volume. A purge at the edge does not clear that cache; a changed source image under an old URL is picked up when the optimiser's 31-day entry expires.

## How to verify

Optimiser, from any machine that can reach the storefront. `<ORIGIN>` is the image origin and `<STORE>` the storefront host. The URL must be percent-encoded:

```
curl -s -D - -o /dev/null -H "Accept: image/avif" \
  "<STORE>/_next/image?url=<ORIGIN>%2Fstatic%2F<path-to-image>.jpg&w=384&q=75"
```

Expect `HTTP 200`, `content-type: image/avif`, `cache-control: public, max-age=2678400, must-revalidate`. The first request reports `x-nextjs-cache: MISS`, a repeat reports `HIT`. Without `Accept: image/avif` (but with `image/webp`) the type is `image/webp`.

Negative checks, all 400: a host not in `remotePatterns`, `w=385` (not in the size lists), `q=50` (not in `qualities`).

Static assets: `curl -s -D - -o /dev/null <STORE>/_next/static/<a file from the page source>` should show `immutable` once, with a single `cache-control` line. Admin images: `curl -s -D - -o /dev/null <ADMIN>/static/<file>` should show `max-age=2678400`.

Layout and weight in a browser. The method used for the numbers below: Playwright-core driving Chrome against `next start` on a production build; image bytes taken from the network responses (unique image requests, `content-length` or body size); layout shifts from `PerformanceObserver` `layout-shift` entries, summed without recent input, with `sources` read to find the moving element. Run once per page and viewport, on a fresh browser context.

## Verification results

Verified 2026-11-28 on the local catalogue, with a production build, in Chrome. All numbers are from the Phase 7 ledger.

Before and after (unique image requests / total image KB / largest image KB / CLS). Baseline is the production build of master after Phase 6; after is the final Phase 7 build (c54f590cec). Every baseline image was `image/jpeg`; every after image was `image/avif`.

| Page | Before | After |
| --- | --- | --- |
| Home (1280x800) | 8 / 3,002 / 670 / 0.0001 | 8 / 27 / 7 / 0.0001 |
| `/us/store` (1280x800) | 12 / 3,237 / 594 / 0.4725 | 12 / 35 / 5 / 0.0001 |
| Product page (1280x800) | 9 / 2,956 / 594 / 0.0061 | 9 / 32 / 7 / 0.0061 |
| Search overlay, `latafa` (1280x800) | 16 / 7,867 / 763 / 0.0001 | 19 / 25 / 7 / 0.0001 |
| `/us/store` at 390 px | 12 / 3,237 / 594 / 0.5617 | 12 / 23 / 3 / 0.0001 |

The `/us/store` CLS was 0.4725 in the first Phase 7 build too (the images were not the cause); the 0.0001 comes from the reserve wrapper above. The search overlay makes 19 requests after, against 16 before.

Optimiser probe (Next 15.5.24, `next start`, a 1800x1678 product JPEG):

- `/_next/image` at `w=384&q=75`: 200, `image/avif`, 4,212 B, against the 253,561 B original. WebP for a WebP-only `Accept`: 5,484 B. `w=360&q=60`: 2,952 B.
- `Cache-Control: public, max-age=2678400, must-revalidate`; a repeat request answered `X-Nextjs-Cache: HIT`.
- A disallowed host: 400. `w=385`: 400. `q=50`: 400.
- `/us` had 8 `srcset`s and a product page 9, all pointing at `/_next/image`; all 202 unique `/_next/image` URLs from the two pages answered 200 `image/avif`.
- After the localhost fix, in a production-mode build with backend URL `http://localhost:9000` and no image origin: `localhost:9000` 200 `image/avif` (4,212 B), `localhost:8000` 400, `127.0.0.1:9000` 400.
- 0 `/_next/image` responses at 400 or above on the home page, `/us/store` and search.

CLS in Chrome with the final build, at 1280 / 390 / 800 px wide:

| Page | 1280 | 390 | 800 |
| --- | --- | --- | --- |
| `/us/store` | 0.0001 | 0.0001 | 0 |
| `/us/search?q=lattafa` | 0.0111 | 0.0035 | 0.019 |
| `/us/search?q=khamrah` | 0.0111 | 0.0035 | 0.019 |
| `/us/search?q=zzzxqj` (no results) | 0.0004 | 0.0004 | 0.0004 |

Automated checks at the measured build (c54f590cec): storefront Vitest 526 passing; `tsc --noEmit` 0 errors; `node --test deploy/*.test.mjs` 72 passing; `next build` exit 0 with 0 lint `Error:` lines. After the final review fixes (loader pass-through, `SafeImage` in `Thumbnail`, the gallery and the search hit, S3 wildcards removed, optimiser caps, cache volume on `cache/images`, private files excluded from the Caddy cache rule): Vitest 544 passing, `tsc` 0, deploy tests 72 passing; not rebuilt or re-measured in a browser. One earlier build attempt failed on a transient `next/font` Google Fonts fetch error and passed on retry.

Defects found only in real Chrome: both abandoned reserve designs (see Layout shift) passed their unit tests while the browser measured CLS of 0.4875 and 0.23 to 0.42.

## Not verified

- **The Caddyfile has never been run through a real Caddy.** There was no `caddy` binary and Docker is not available on the dev machine, and an attempt to download a Caddy release was blocked. `caddy validate` has not run, so the `header_down` rule and the `handle` structure are checked only by the repo's text tests (`deploy/*.test.mjs`) and by reading Caddy's directive order.
- **The Docker image build and the cache volume.** The storefront image was not built, the `storefront-image-cache` volume was not mounted, and the ownership behaviour (empty volume takes the image directory's owner; an old root-owned volume does not) is from Docker's documented behaviour, not observed here.
- **Cloudflare in front.** Nothing was configured or tested, including whether the cache key separates AVIF from WebP responses.
- **Real devices, slow networks and other browsers.** Only desktop Chrome was driven, on a local machine and network.
- **Pages and widths.** The `/us/store` and search shifts were measured at 1280, 390 and 800 px only; other widths (and category and collection pages) were not.
- **Placeholders.** Per-image blur placeholders were out of scope; a plain paper-coloured box is used.
- **sharp in the Linux standalone output.** Whether `sharp` and `@img/sharp-linux-x64` are traced into `.next/standalone` on the Linux image build was not checked (the measurements used `next start` on Windows). After the first image build, run `ls .next/standalone/node_modules/@img` in the build stage (or `ls /app/node_modules/@img` in the runtime container) and make one `/_next/image` request inside the container.
- **`NODE_ENV` when `next build` loads the config.** The production localhost rule depends on `NODE_ENV` being `production` when `next.config.js` is evaluated at build time (the patterns are serialised into the build). Checked by reading Next 15.5.24, not by a build: `next/dist/bin/next` sets `process.env.NODE_ENV = process.env.NODE_ENV || defaultEnv` in a commander `preAction` hook, with `defaultEnv` `production` for every command except `dev`, before `build/index.js` calls `loadConfig(PHASE_PRODUCTION_BUILD, ...)`. A `NODE_ENV` that is already set is kept (Next only warns), so a build run with `NODE_ENV=development` would bake in the any-port localhost pattern. The build stage of `deploy/storefront.Dockerfile` does not set `NODE_ENV`. The standalone `server.js` sets `NODE_ENV=production` and reads the serialised config, so the runtime value does not change the patterns.
- **The loader pass-through in a browser.** No channel-imported (Shopify, WooCommerce) URLs were in the local catalogue, so the direct load of an unserved host is covered by unit tests only.
- **Build-time-only behaviour.** The measurements ran through `next start`, not through the standalone `node server.js` that production uses. Both read the same serialised config.

Deferred minor findings from review that are worth knowing (all in the ledger):

- Cart item `sizes` is a flat `96px`, not per breakpoint (the real slot is 48 px on mobile and 64 px in the preview). The account order card's `25vw` is about 1.4 times larger than the slot.
- `GRID_SIZES` over-requests on the homepage product rail at 1024 to 1279 px (that rail is four columns there).
- `[::1]` in the local-host list is written as `"[::1]"`. It becomes a `remotePatterns` hostname only when it is the configured origin. Next's matcher (picomatch) compiles it to a pattern that does match `[::1]`, and also `1` and `:` (the brackets read as a character class); harmless, since it only exists when an operator configures `[::1]` as the origin. Untested.
- A non-local origin on the default port has no `port` key in its pattern, so it allows any port on that host. The host is operator-configured.
- `SafeImage`'s `onError` for a 400 from `/_next/image` is verified only natively in a browser, not in jsdom, where `next/image` does not issue the request.
- Thumbnail tests assert the mocked `sizes` prop, not the rendered attribute; the `SafeImage` priority test is weak and the preload-link assertions depend on Next internals.
- Admin host has no `encode`; the `/static/*` cache rule applies to every backend static file except `private-*` ones.
- Test hygiene: the Dockerfile test matches one exact `RUN` string, the Caddyfile tests cut a host block at the first closing brace, and some test lines are long (prettier is not enforced).
