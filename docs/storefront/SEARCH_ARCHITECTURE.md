# Storefront Search Architecture

How product search works end to end (Phase 6): the engine, the index, the storefront pieces, how to operate it, and what has and has not been verified. This describes only what is implemented. The decision and design are in `docs/superpowers/specs/2026-11-27-storefront-phase-6-search-design.md`.

## Architecture

```
Medusa product events ──> Search Module (consume / seed / catch-up, unchanged)
                               │  index provider = "meilisearch"
                               ▼
              Meilisearch provider (apps/backend/src/providers/search-meilisearch)
                               │  Meilisearch v1.58.0, master key held by the backend only
                               ▼
        POST /store/search  (Medusa Search Module contract, unchanged)
                               ▲
   ┌───────────────────────────┴───────────────────────────┐
   │ Storefront (browser)                                  │
   │  - nav overlay (autocomplete)  - /search page         │
   │  - /store listing (Phase 4)                           │
   │  all through @medusajs/instantsearch-adapter          │
   └───────────────────────────────────────────────────────┘

Storefront server ──> GET /store/search/popular, GET /store/search/trending
/search page (browser) ──> POST /store/search/events ──> search_query table
```

- The browser never talks to Meilisearch. It talks to the backend `/store/search` through the InstantSearch adapter, as the `/store` listing already did. The Meilisearch key exists only in backend environment.
- The Search Module owns the indexing lifecycle: product, variant, option, tag, category, sales-channel and stock events re-index the affected products, `product.deleted` removes documents, and a catch-up pass repairs missed events. Phase 6 added only the provider and the index definition. The event list and its known gaps (`TODO` comments) are in `apps/backend/src/search/product.ts`.
- Popular searches and trending products come from the backend `search-insights` module and two store routes, not from Meilisearch.

## Provider and index design

### Provider

`apps/backend/src/providers/search-meilisearch/` is a custom Search Module provider (`identifier = "meilisearch"`) registered in `apps/backend/medusa-config.ts`. It implements the module's provider methods plus `searchMany` (one multi-search round trip) and `waitForTask`. Writes wait for the Meilisearch task and a failed task throws, so the module's logs and error handling see it.

| Part | File | What it does |
| --- | --- | --- |
| Service | `services/meilisearch-search.ts` | Client, fixed error texts, 3 s request timeout, task waiting (60 s) |
| Filters | `utils/filters.ts` | Medusa filter DSL to a Meilisearch filter string |
| Query | `utils/query.ts` | Search request: pagination, sort, facets, highlight, match strategy, typo flag |
| Result | `utils/result.ts` | Meilisearch response to the module's result shape, facets and facet stats |
| Settings | `utils/settings.ts` | Index settings from the index field definitions |
| Synonyms | `utils/synonyms.ts` | The editable synonym groups |

Registration, in `medusa-config.ts`:

- The search module is registered explicitly with two providers and `default_provider: 'meilisearch'`.
- The Postgres provider (`search-postgres`, id `postgres`) stays registered on purpose. Indexes built before this phase are recorded against it, and the module drops the old index versions during `db:migrate` through that provider. Without it the drop fails, the old records are retried on every migration and their tables stay.
- The provider throws at startup if `MEILISEARCH_HOST` or `MEILISEARCH_API_KEY` is missing (the host falls back to `http://127.0.0.1:7700` in `medusa-config.ts`, so in practice the key is what stops the backend).

### Index fields

Defined in `apps/backend/src/search/product.ts`. The index selects the provider with `provider: "meilisearch"`.

| Field | Type | Searchable (weight) | Filter | Facet | Returned on hits |
| --- | --- | --- | --- | --- | --- |
| `title` | text | yes (3) | | | yes (sortable) |
| `brand` | keyword[] | yes (3) | yes | yes | yes |
| `sku` | keyword[] | yes (2) | | | yes |
| `option_values` | keyword[] | yes (2) | yes | yes | yes |
| `category` | keyword[] | yes (1) | yes | yes | yes |
| `fragrance_family` | keyword[] | yes (1) | yes | yes | yes |
| `notes` | keyword[] | yes (1) | yes | yes | yes |
| `gender` | keyword[] | yes (1) | yes | yes | yes |
| `concentration` | keyword[] | yes (1) | yes | yes | yes |
| `description` | text | yes (1) | | | no (searched only) |
| `labels` | keyword[] | | yes | yes | yes |
| `in_stock` | boolean | | yes | yes | yes |
| `id`, `handle`, `thumbnail`, `single_variant_id`, `created_at` | | | `id` filterable, `created_at` sortable | | yes |
| `status`, `sales_channel_ids` | | | yes | | no (used to scope results, never returned) |
| price fields (`min_price_<cur>`, `on_sale_<cur>`, ...) | | | | | see `apps/backend/src/search/helpers/pricing.ts` |

`apps/backend/src/search/product.ts` is the source of truth for the exact flags. `brand`, `gender`, `fragrance_family`, `notes` and `concentration` come from categories and product `metadata` (see `docs/storefront/CATALOG.md`, "Owner setup").

### Settings the provider writes

`buildSettings` derives these from the field definitions, on `upsertIndex`:

- **Searchable order.** Meilisearch ranks matches by attribute order, so the list is ordered by weight descending, then declaration order: `title`, `brand`, `sku`, `option_values`, `category`, `fragrance_family`, `notes`, `gender`, `concentration`, `description`. An index with no searchable field throws, because an empty list would make Meilisearch search every attribute, including the hidden `status` and `sales_channel_ids`.
- **Typo tolerance** on, and off for `sku` (`disabled_on_attributes: ["sku"]` in the index definition). SKUs match whole or by prefix, never fuzzily.
- **Displayed attributes** are the retrievable fields. Children of a non-retrievable object inherit that.
- **Filterable, sortable and facetable** attributes from the field flags. `faceting.maxValuesPerFacet` is 200 and `pagination.maxTotalHits` is 10000.
- **Synonyms** from `utils/synonyms.ts`, applied separately from the settings.

### Synonyms

`utils/synonyms.ts` holds 16 groups. Each group is written once and expanded so every member lists all the others. Current groups:

- Brands and abbreviations: `edp` = `eau de parfum`, `edt` = `eau de toilette`, `edc` = `eau de cologne`, `ysl` = `yves saint laurent`, `cdg` = `comme des garcons`, `mfk` = `maison francis kurkdjian`, `jpg` = `jean paul gaultier`, `ck` = `calvin klein`, `d&g` = `dolce & gabbana` = `dolce and gabbana`.
- Sizes: `30ml` = `1oz`, `50ml` = `1.7oz`, `100ml` = `3.4oz` (with spaced variants).
- Words: `perfume` = `parfum` = `fragrance`; `cologne` = `aftershave`; `men` = `mens` = `men's` = `man`; `women` = `womens` = `women's` = `ladies` = `woman`.

A term may appear in only one group (a duplicate throws). `men's` is tokenised by Meilisearch as `men` + `s`, which is why `mens` needs its own entry.

## Environment variables

| Variable | Where | Meaning |
| --- | --- | --- |
| `MEILISEARCH_HOST` | backend | Base URL of Meilisearch. Local default `http://127.0.0.1:7700`. In compose it is set to `http://meilisearch:7700` |
| `MEILISEARCH_API_KEY` | backend, and the Meilisearch container | The master key. The backend refuses to start without it |

Both are backend-only. Nothing in `apps/storefront` reads them, and there is no `NEXT_PUBLIC_` copy. Do not add one.

Documented in `apps/backend/.env.template` (both variables) and `deploy/.env.example` (`MEILISEARCH_API_KEY` only; compose sets the host). `deploy/docker-compose.yml` fails with a clear message if the key is unset.

## Running Meilisearch

### Local (Windows dev)

```
# put MEILISEARCH_API_KEY in apps/backend/.env (random, 16+ characters), then
powershell -File scripts/dev/meilisearch.ps1
```

The script downloads the pinned official v1.58.0 Windows binary into `.meilisearch/` if it is missing, checks its SHA-256, and starts it on `127.0.0.1:7700` with data in `.meilisearch/data` (git-ignored). The key comes from the environment, else from `apps/backend/.env`; the script exits with a message if neither has one. `-Foreground` keeps it attached to the console; `-Root <path>` reuses another checkout's binary.

### Compose

`deploy/docker-compose.yml` has a `meilisearch` service (`getmeili/meilisearch:v1.58.0`, `MEILI_ENV: production`, data volume `meilisearch-data`, `mem_limit: 512m`, health check on `/health`). No port is published: only the backend reaches it over the internal network. The 512 MB limit is a floor, not a measurement.

Keep the version in step in three places: `scripts/dev/meilisearch.ps1`, `deploy/docker-compose.yml`, `.github/workflows/ci.yml`.

### CI

The backend integration job in `.github/workflows/ci.yml` has a `meilisearch` service container (same image tag) with an ephemeral key, and sets `MEILISEARCH_HOST` and `MEILISEARCH_API_KEY` for the job. See "Not verified": that job has not run yet.

## Editing synonyms

1. Edit `apps/backend/src/providers/search-meilisearch/utils/synonyms.ts`.
2. With the backend's Meilisearch reachable, from `apps/backend`:

   ```
   npx medusa exec ./src/scripts/sync-search-settings.ts
   ```

   It re-applies the settings and synonyms to the physical index that is serving reads, without recreating or reseeding it, and prints the index name and the number of synonym groups (never the key).

Editing synonyms does not change the index schema hash, so a restart or `db:migrate` alone does not apply the change. The sync script is the way. It calls `upsertIndex` through protected Search Module members (`as any`; the module exposes no public accessor), so a Medusa upgrade can break it.

## Reindexing

A change to the field definitions in `src/search/product.ts` changes the schema hash and needs a rebuild:

```
npx medusa db:migrate --execute-safe-search
```

Then start the backend: the module creates the new physical index version and reseeds it from the catalogue. Migrating from the old Postgres index created `product_v3` and reseeded 3,431 documents in 1 min 5 s; a later schema change built `product_v4` in 22 s (both recorded in the ledger). Searches keep using the previous version until the new one is active. Do not remove the Postgres provider from `medusa-config.ts` (see above).

## Storefront pieces

| Piece | Location | Notes |
| --- | --- | --- |
| Overlay | `apps/storefront/src/modules/layout/components/search/` | Opens from the nav icon; full-screen on mobile, anchored panel on desktop. ARIA combobox/listbox |
| `/search` page | `apps/storefront/src/app/[countryCode]/(main)/search/page.tsx`, `modules/search/templates/` | Query in the URL (`/search?q=`), results grid with the Phase 4 filters, sort, view toggle, pagination. `noindex, follow` |
| Recent searches | `lib/util/recent-searches.ts` | `localStorage` key `sc-recent-searches`, cap 8, clearable, this browser only |
| Highlighting | `lib/util/highlight.tsx` | Converts `<mark>` markers to React elements |
| Keyboard navigation | `lib/util/combobox-nav.ts` | Reducer for next, previous, first and last across all sections |
| Insights data | `lib/data/search-insights.ts` | Server-side popular and trending fetch |
| Search tracking | `lib/data/track-search.ts` | Fire-and-forget event POST |

Overlay behaviour:

- Empty input shows recent searches, popular searches and trending products. A section with no data is hidden, never faked.
- Typing shows product suggestions (thumbnail, highlighted title, brand, price), matching brands and categories, and a "See all results" row to `/search?q=`.
- Up and Down move across every row of every section, Enter opens the row or runs the search, Escape closes and returns focus to the nav search field. Mobile has a focus trap and locks body scroll.
- Prices use the region's currency; if the region lookup fails the first indexed currency is shown (a known deferred minor).

### Where searches are recorded

The `/search` page is the single place that records searches. It knows the true result count, and every entry path (Enter in the overlay, a recent search, a popular search, a brand link) lands there. The overlay never calls `trackSearch`; it only keeps the recent-searches list.

The page records a query only when the results have settled and no refinements are active (the gate reads the settled results' own helper state, not only the UI state), once per query per page mount, so the recorded count is the unfiltered hit count. A refined first load is recorded later if the visitor clears the refinements. `SearchResults` is keyed by the query so a client-side query change resets the tracker.

### Popular and trending

| Route | Returns | Rules |
| --- | --- | --- |
| `POST /store/search/events` | `{ ok: true }` always | Records a search in `search_query` (upsert on the normalised query: count, last seen, last result count). Query 3 to 60 characters after normalising and containing a letter or digit; body `query` max 200, `results` an integer 0 to 100000. Invalid bodies, rate-limited clients and failures are swallowed (failures logged) so clients never retry-loop |
| `GET /store/search/popular` | `{ queries: [{ query, count }] }` | Last 30 days, seen at least 2 times, last result count above 0, highest count first, capped at 8 |
| `GET /store/search/trending?limit=` | `{ products: [{ id, title, handle, thumbnail }] }` | Units sold in the last 14 days from non-cancelled, non-draft orders, restricted to published products in the request's sales channels; filled up with the newest products. `limit` defaults to 8 and is clamped to 12 |

Details a maintainer needs:

- Trending scans at most 20 pages of 1000 orders and keeps a 5-minute in-process cache keyed by the sorted channel ids and limit. With no sales-channel context (no publishable key) it returns an empty list.
- Both read routes catch failures, log them and return an empty list. A degraded response is sent with `Cache-Control: no-store`; a good one with `Cache-Control: public, max-age=300`.
- The storefront fetches popular and trending server-side with a 2.5 s timeout and a 300 s revalidate; any failure hides the section.
- `Vary` note for a future CDN: the trending response depends on the publishable key's sales channels but is sent `public`. The storefront uses one key, so this is fine today. If a shared CDN is put in front of the backend, add `Vary: x-publishable-api-key` (Phase 13).
- Search events need the publishable key header like any `/store` route. The route is otherwise public.

## Error behaviour

- Meilisearch unreachable or slow: the provider times out after 3 s and `/store/search` answers with a server error and the fixed text `Search is temporarily unavailable.` (a missing index answers `The search index is not available.`). Raw client errors, which can carry request headers, are not passed through.
- The overlay and the `/search` page show `Search is unavailable right now. Please try again.` when the request fails. The overlay does not stay on "Searching…".
- `/store/products` and the rest of browsing and checkout do not use Meilisearch and keep working.
- Popular, trending and search events degrade to empty lists or a swallowed failure.

## Security notes

- The master key is backend-only. A scan of `.next/static` in the production build found no secret.
- Highlights are rendered as React elements, never `dangerouslySetInnerHTML`. `/store/search` lets a caller choose the highlight tags, so `renderHighlight` recognises only the exact `<mark>` tag the storefront requests and treats everything else as text.
- The rate limiter on `POST /store/search/events` is a fixed window of 30 events per minute per key, held in process memory. With several backend instances each enforces its own budget.
- The key is `req.ip`. Medusa sets Express `trust proxy` to 1, so only the last proxy hop is believed. Behind two proxy hops (for example a CDN in front of a load balancer) every shopper could share one bucket. Confirm the deploy topology before Phase 13.
- The events route is public by design. Its writes are bounded by the limiter, the length caps and the normalisation rules; a determined client can still add low-count noise, which the "seen at least 2 times and has results" popular rule limits but does not eliminate.

## Maintainer rulings

Decisions made during the build that are not obvious from the code:

- **Dynamic import of `meilisearch`.** The client package is ESM-only, so the service loads it with `import("meilisearch")` on first use (same pattern Medusa uses for `xxhash-wasm`). A static import is not possible in this CommonJS backend. A failed load is retried on the next call.
- **Integration spec runs without `--experimental-vm-modules`.** `apps/backend/jest.config.js` has a `transformIgnorePatterns` entry for the ESM client. It replaced the default pattern (the `.pnp` entry was dropped).
- **Fail loud.** The backend requires `MEILISEARCH_API_KEY` at start.
- **Postgres provider stays registered** so migrations can drop old index versions.
- **Filters fail closed.** An empty `$or` or `$not` throws, an `$or` with an unconstrained branch is unconstrained (never narrowed), and an unsupported combination throws instead of returning wrong results. `undefined` field values are dropped.
- **An empty searchable set throws**, and children of a non-retrievable object inherit `retrievable: false`.
- **Insights routes fail closed and degrade.** No channel context returns an empty trending list; failures return empty lists.
- **No client-side per-query result cache.** The spec said results are cached per query by the adapter. This was not done: the shared search client keeps a 0 s cache for the listing's fresh facets and Meilisearch answers in a few milliseconds.
- **The `/search` page records searches**, the overlay does not (above).
- **Overlay links are not country-prefixed.** A browser check flagged `/search?q=` without `/us`. The storefront middleware rewrites unprefixed paths and `LocalizedClientLink` uses its hrefs as given, so `/search?q=ysl` renders correctly and the finding was withdrawn.
- **Search routes always answer 200 for events**: validation happens with `safeParse` in the handler, not middleware, to keep that contract.

## Deliberately not done

- Semantic or vector search, personalised ranking, multi-language search.
- An admin UI for synonyms (the file is edited in code).
- Analytics dashboards beyond the two public routes.
- A client-side per-query result cache (above).
- Server-rendered hits on `/search` (the page is `noindex`).
- Production Meilisearch hosting (Phase 13).

## Verification results

Verified 2026-11-27, against the 3,431-product catalogue on a local backend and a local Meilisearch v1.58.0. All numbers below are from the Phase 6 ledger.

Index and queries (index `product_v4`, 3,431 documents, built in 22 s):

| Query | Hits |
| --- | --- |
| `lattafa` | 44 |
| `latafa` (typo) | 43 |
| `khamrah` | 1 |
| `AI0079777` (SKU) | 1 |
| `ai00797` (SKU prefix) | 3 |
| `ysl` | 4 |
| `yves saint laurent` | 4 |
| `vanilla perfume` | 6 |
| `oud perfume` | 139 |
| `mens fragrance` | 1539 |
| `womens perfume` | 1882 |
| `fresh citrus` | 20 |
| `edp 100ml` | 1861 |
| `dior sauvage` | 12 |
| `Hermes` | 71 |

- The first run, on `product_v3`, found two gaps that these numbers already reflect as fixed. `mens fragrance` returned 0 until gender synonyms were added, and then only matched through `man` and the title; brand, category, gender, family, notes and concentration were not searchable yet. Making them searchable changed the schema, hence the `product_v4` reindex.
- Facet counts match Phase 4: Women 1561, Men 1260, Men's Sets 220, Women's Sets 207, Women's Body Mists 111, Men's Deodorants & Body Sprays 53, Unisex 19.
- Latency: 50 typical queries measured at the backend round trip: p50 17 ms, p95 57 ms, max 91 ms (the spec's bound was p95 under 200 ms).
- Meilisearch stopped: `/store/search` answered HTTP 500 in 0.05 s with the fixed text `Search is temporarily unavailable.`, and `/store/products` stayed 200.
- Search events: migration `Migration20261127140510` applied (table `search_query`). Valid and invalid bodies both returned 200. Three identical events gave count 3 with the last result count kept; a 2-character query and a non-string query were not stored. The smoke rows were deleted.
- Popular: returned `{"queries":[{"query":"khamrah","count":2}]}` with `Cache-Control: public, max-age=300`. A query seen once and a zero-result query were excluded.
- Trending: `limit=5` returned 5 products with `{id,title,handle,thumbnail}`; `limit=abc` returned 8; `limit=99` returned 12.
- Settings sync: `sync-search-settings.ts` ran against the live index ("Applied settings and 16 synonym groups to product_v3").
- Real browser (Chrome, production build, 1280x800 and 390x844 mobile): the overlay takes focus on open; the typo `latafa` gave 14 options with highlight, thumbnail, brand and price; ArrowDown moves `aria-activedescendant` to a real option and ArrowUp wraps; Escape closes and returns focus to the nav search field; Enter opens the search page; recent searches listed `ysl` with no buttons inside the listbox; the mobile overlay was full-screen with brands and categories sections and body scroll lock. A scan of `.next/static` found no secret.

Defects the browser check found that mocked tests had missed:

- **`/search` ignored `q`.** It showed all 3,431 products and the request had no text query, because InstantSearch drops a routed `query` when there is no search box widget. Fixed with `<Configure query={query}>` plus a test with a recording client.
- **The overlay stayed on "Searching…" when `/store/search` failed**, because the error branch was checked after the loading branch. Fixed (error branch first, `useInstantSearch({ catchError: true })`) with a rejecting-client test.
- **The store's own empty state** (the Phase 4 `/store` one) was what showed on a search with no hits, instead of the search page's own message. This defect was reported from the browser check; the ledger does not describe its fix beyond the Task 11 empty-state rounds, so treat the exact cause as unrecorded.

The earlier mocked component tests passed with all three present because they replaced `react-instantsearch` and the client. What guards them now: tests that render the real `react-instantsearch` with a recording or rejecting search client, in `modules/layout/components/search/search-overlay-error.test.tsx` and `modules/search/templates/search-results.integration.test.tsx`. The main overlay test (`search-overlay.test.tsx`) still mocks InstantSearch, so it does not guard these.

## Not verified

- **CI.** The `meilisearch` service and env in `.github/workflows/ci.yml` have not run. The integration job and the backend start-up check have not been seen green with them.
- **Production hosting and the Docker image.** Docker is not installed on the dev machine, so the compose `meilisearch` service, its health check and the 512 MB limit were never started. Production hosting of Meilisearch is Phase 13.
- **Devices and browsers.** Only Chrome was checked, desktop and a 390x844 viewport. No real touch device, no other browser, no screen reader.
- **Re-check of two fixes in a browser.** The ledger records the `/search` `q` fix and the overlay error state as fixed with tests that use the real `react-instantsearch`; it does not record a second browser pass after them.
- **Searching by notes, family or concentration.** These come from product `metadata` the owner supplies (`notes`, `fragrance_family`, `concentration`; see `docs/storefront/CATALOG.md`). The perfume import script writes `metadata.gender` from the `(M)`, `(W)` or `(U)` marker in the supplier description and writes none of the other three. No live query on notes or family is recorded, so a notes or family search finding nothing until the owner enters them is expected but unverified. How many of the 3,431 products carry `metadata.gender` is unverified.
- **Review ordering** is unrelated to this phase and was not looked at.
- **The deploy topology** (proxy hops in front of the backend), which decides whether the events rate limiter and `req.ip` behave as intended.

Deferred minor findings from review that are worth knowing (all in the ledger):

- Two events hitting a missing index at once can race on index creation (`index_already_exists` is not treated as success).
- A hyphenated SKU tokenises on the hyphen; the ledger asked for a live check that is not recorded.
- Filter translation: non-array `$and`/`$or` and non-object `$not` raise a `TypeError`, not a `MedusaError`; `$exists` uses truthiness; a field named `q` cannot be filtered.
- Facet limit, sort and other-count are computed client-side over Meilisearch's top 200 values per facet.
- The `perfume`/`parfum`/`fragrance` synonym group is broad, and `d&g` tokenisation has no test.
- The Trending cache never evicts expired keys, and concurrent cache misses each run the scan.
- `track-search` goes through `sdk.client.fetch`, which adds a locale-header round trip on the server.
- A highlight with many unclosed `<mark>` markers is worst-case quadratic.
- Overlay: the list blanks to "Searching" on each keystroke; the active row can shift when a recent search is removed; Escape is handled twice; the Clear and remove buttons were moved out of the listbox but a focus-trap and scroll-lock are not asserted in unit tests.
- Pre-existing and out of scope: the Phase 4 `/store` error state prints `error.message`.
- `scripts/dev/meilisearch.ps1` passes the master key on the command line (dev only).
