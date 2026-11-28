# Service memory

Measured with `deploy/measure-memory.ps1 -Local` (Windows) or
`deploy/measure-memory.sh [--local]` (Linux, or Docker mode). Both are
read-only: they read the process list or `docker stats --no-stream` and never
stop, start or signal anything. `-Smoke` / `--smoke` adds one GET to the service
health URL between the two reads; the default is a pure read.

## Dev mode (Vite and Turbopack included), measured 2026-11-22, not production

Working set (MB) of the process listening on each port, pure read, no smoke
request (so after smoke equals after boot).

| name | port | rss_mb_after_boot | rss_mb_after_smoke |
| --- | --- | --- | --- |
| backend | 9000 | 71 | 71 |
| seller-hub | 7005 | 61 | 61 |
| storefront | 8000 | 57 | 57 |
| pos | 8001 | 10 | 10 |

Caveat: this is the listening process only. Medusa dev, Vite and Turbopack run
child or worker processes that are not counted, and the servers were mostly
idle, so these values understate real use. They are a lower bound, not a peak.

## Production (Docker)

| name | rss_mb_after_boot | rss_mb_after_smoke |
| --- | --- | --- |
| backend | pending first compose run | pending first compose run |
| seller-hub | pending first compose run | pending first compose run |
| storefront | pending first compose run | pending first compose run |
| pos | pending first compose run | pending first compose run |

## Container limits

Rule: measured peak plus 25 percent, rounded up to 64 MB, never below a floor.
`NODE_OPTIONS=--max-old-space-size` is 75 percent of the limit. Dev
measurements plus 25 percent are below every floor, so the floors apply.

| service | mem_limit | max-old-space-size (MB) |
| --- | --- | --- |
| backend | 1g | 768 |
| migrate (backend image) | 1g | 768 |
| storefront | 512m | 384 |
| seller-hub | 384m | 288 |
| pos | 128m | 96 |
| caddy | 128m | not Node |
| postgres | 512m | not Node |
| redis | 128m | not Node |

These are conservative starting points. After the first compose run, record
`docker stats` here and tighten or raise them.

## Storefront image optimiser

Since storefront Phase 7 the storefront resizes and encodes images itself
(`/_next/image`, sharp, AVIF then WebP). Points for the 512m limit:

- sharp (libvips) allocates its pixel buffers in native memory, outside the
  V8 heap, so `--max-old-space-size=384` does not cap it. Heap plus sharp
  must stay under the container's 512m, or the kernel kills the container.
- `next.config.js` limits this: `experimental.imgOptConcurrency: 1` (one sharp
  job at a time) and `experimental.imgOptMaxInputPixels: 25000000` (sources
  above 25 MP are refused; the catalogue originals are about 3 MP).
- AVIF encoding is CPU heavy. After a deploy with an empty cache, the first
  request for each image, width and format pays the encode; the first page
  views are slower until the cache warms. Resized files are kept on the
  `storefront-image-cache` volume, so a normal redeploy keeps them.
- Disk: `images.maximumDiskCacheSize` is 2 GB (least recently used entries are
  evicted). Without it Next uses half the free disk.
- Clearing the cache: stop the storefront, then
  `docker volume rm <project>_storefront-image-cache` and start it again;
  Docker recreates the volume owned by `node` from the image.

Record the storefront's `docker stats` peak after a cold-cache crawl of the
home page, a listing and a product page; raise the limit if it nears 512m.

## Laptop advice

The dev machine runs low on memory when all five processes run together
(backend, seller-hub, storefront, POS, plus Postgres and Redis).

- Run only the apps you need for the task at hand.
- Build the admin dashboard once (`yarn build` in `packages/admin/dashboard`)
  instead of running the Vite dev server.
