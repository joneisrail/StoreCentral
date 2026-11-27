# Storefront Phase 6: Advanced Search (Meilisearch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Meilisearch-backed storefront search with typo tolerance, SKU/notes/family search, synonyms, an autocomplete overlay, a `/search` page, and real popular-search and trending data.

**Architecture:** A new Medusa search provider (`meilisearch`) sits behind the existing `/store/search`, so the storefront's InstantSearch adapter and request shape stay. The Search Module keeps owning indexing (events, seed, catch-up, delete). New backend pieces: provider, index fields, `search-insights` module with two public routes. New storefront pieces: autocomplete overlay, `/search` page, recent-searches store.

**Tech Stack:** Medusa v2 search framework (`AbstractSearchProviderService`), `meilisearch` JS client, Meilisearch server (Windows binary in dev), Next 15.5 / React 19, react-instantsearch, Jest (backend), Vitest (storefront).

**Spec:** `docs/superpowers/specs/2026-11-27-storefront-phase-6-search-design.md`

## Global Constraints

- Provider code: `apps/backend/src/providers/search-meilisearch/`. Tests for anything under `apps/backend/src/search/**` go in `apps/backend/src/__tests__/search/`: Medusa's `SearchIndexLoader` imports every file under `src/search` (this crashed the backend in Phase 4). Provider tests live in `apps/backend/src/__tests__/providers/search-meilisearch/`.
- Env (backend only): `MEILISEARCH_HOST` (default `http://127.0.0.1:7700`), `MEILISEARCH_API_KEY` (master key). Nothing Meilisearch-related in `NEXT_PUBLIC_*` or any storefront file. Browser traffic goes through `/store/search` only.
- Meilisearch HTTP timeout 3000 ms. Provider never throws raw client errors to the storefront: wrap in `MedusaError` with fixed text.
- Backend rules: mutations through workflows; Zod from `@medusajs/framework/zod`; GET and POST only; static imports.
- Storefront rules: server actions return fixed-text results and never throw; Tailwind 3 tokens (`ivory paper charcoal warm-grey line line-strong gold gold-deep`, `font-serif`), no alpha on CSS-var colours; render highlights as React elements, never raw HTML.
- Backend tests: from `apps/backend`, `TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand --forceExit <paths>`. Storefront tests: Vitest in `apps/storefront`.
- `next build` runs from a sibling copy outside the worktree (junction `node_modules`, `package.json` without BOM); `next lint` `Error:` lines fail the build. No `ln -s`; use PowerShell junctions. A search index schema change needs `npx medusa db:migrate --execute-safe-search`, then a boot to reseed.
- Meilisearch server version pinned at install (v1.12 or newer); `meilisearch` npm client pinned to the exact version installed in Task 1.

## Review Focus

1. A filter value containing quotes, backslashes or Meilisearch keywords (`Men's`, `L"Eau`, `x" OR id != "`) must be escaped so a shopper cannot alter the filter. Pinned in Task 2.
2. Empty, whitespace-only and 500-character queries: empty returns everything (the `/store` listing relies on it), long queries are rejected or truncated, never a 500. Task 3 and Task 9.
3. Meilisearch stopped or slow: `/store/search` returns a clean error within about 3 s; the overlay shows fixed text; `/store` and checkout are unaffected. Tasks 5 and 11.
4. Names with accents or punctuation (`Hermès`, `Men's Sets`, `Dolce & Gabbana`) are searchable, filterable and highlightable. Tasks 2, 6, 9.
5. Popular searches must not be polluted: zero-result queries, one-off queries, spam from one client, and 1 to 2 character queries are not recorded or not shown. Task 7.

---

### Task 1: Meilisearch dev service, env, compose

**Files:**
- Create: `scripts/dev/meilisearch.ps1` (download pinned release to `.meilisearch/` if missing, start it with `--master-key` from env, db dir `.meilisearch/data`)
- Modify: `.gitignore` (`.meilisearch/`), `apps/backend/.env.template` (`MEILISEARCH_HOST`, `MEILISEARCH_API_KEY` with a comment that the key is backend-only), root or deploy `docker-compose*.yml` (add a `meilisearch` service with image pinned to the same version, volume, env master key; no published port in production profile), `apps/backend/package.json` (add `meilisearch` dependency at the exact version installed)

**Interfaces:**
- Produces: a running Meilisearch on `http://127.0.0.1:7700` and `MEILISEARCH_*` env names every later task uses.

- [ ] **Step 1:** Run `scripts/dev/meilisearch.ps1`; this downloads the official Windows release from the Meilisearch GitHub releases page (confirm the exact asset URL and checksum in the script). Verify `curl http://127.0.0.1:7700/health` returns `{"status":"available"}`.
- [ ] **Step 2:** `npm install meilisearch@<version>` in `apps/backend`; record the pinned versions in the commit message.
- [ ] **Step 3:** Add the env, gitignore and compose entries. Validate compose with `docker compose config` only if docker exists; otherwise just YAML-parse it.
- [ ] **Step 4: Commit** `chore(search): meilisearch dev service, env and compose entry`.

### Task 2: Filter translation (pure)

**Files:**
- Create: `apps/backend/src/providers/search-meilisearch/utils/filters.ts`
- Test: `apps/backend/src/__tests__/providers/search-meilisearch/filters.unit.spec.ts`

**Interfaces:**
- Produces: `toMeiliFilter(filters: SearchTypes.SearchFilters | undefined): string | undefined` (without `q`; `q` is lifted by the module) and `escapeValue(value: SearchFilterValue): string`.

- [ ] **Step 1: Write failing tests**: `{category: "Men"}` gives `category = "Men"`; array value gives `category IN ["Men","Unisex"]`; `{in_stock: true}` gives `in_stock = true`; `{min_price_usd: {$gte: 10, $lte: 50}}` gives `min_price_usd >= 10 AND min_price_usd <= 50`; `$or`, `$and`, `$not` nest with parentheses and `NOT`; `$exists`, `$ne`, `$nin`, `$overlaps`, array `$contains` map to `EXISTS`/`!=`/`NOT ... IN`/`IN`/membership; `undefined` and `{}` return `undefined`; injection: `{brand: 'x" OR id != "'}` yields a single quoted, escaped literal (backslash and quote escaped) and `Men's`, `Hermès` pass through intact; `$like`, `$prefix` and Date values throw a `MedusaError` naming the operator.
- [ ] **Step 2:** Run and see them fail.
- [ ] **Step 3:** Implement the two functions; field names are validated against `/^[A-Za-z0-9_.]+$/` and throw otherwise.
- [ ] **Step 4:** Tests pass. **Step 5: Commit** `feat(search): meilisearch filter translation`.

### Task 3: Query and result translation (pure)

**Files:**
- Create: `apps/backend/src/providers/search-meilisearch/utils/query.ts`, `utils/result.ts`
- Test: `apps/backend/src/__tests__/providers/search-meilisearch/query.unit.spec.ts`, `result.unit.spec.ts`

**Interfaces:**
- Consumes: `toMeiliFilter` from Task 2.
- Produces: `toMeiliQuery(input: SearchTypes.ProviderSearchQuery): { indexUid: string; params: MeiliSearchParams }` and `fromMeiliResponse(response: MeiliResponse, input: SearchTypes.ProviderSearchQuery): SearchTypes.SearchResult`.

- [ ] **Step 1: Write failing tests** for `toMeiliQuery`: `q` becomes `q`; `pagination {skip: 24, take: 12}` becomes `offset 24, limit 12` (defaults 0 and 20, `take` capped at 100); `order {title: "ASC"}` becomes `sort ["title:asc"]`; `match_strategy` maps `all`/`last` to `matchingStrategy` (`any` maps to `last`... verify mapping from the Meilisearch docs and assert it); `attributes_to_retrieve` becomes `attributesToRetrieve`; value facets become `facets: [field]`; `stats` facets add the field to `facets` and set a flag to read `facetStats`; `range` facets throw; `highlight {fields, pre_tag, post_tag}` becomes `attributesToHighlight`, `highlightPreTag`, `highlightPostTag`; `typo_tolerance: false` is surfaced for the settings-level caveat (document: Meilisearch applies it per index, so the provider reports it in `provider_metadata.typo_tolerance_ignored` rather than silently ignoring); `q` of 500+ characters is truncated to 200.
  For `fromMeiliResponse`: hits map to `{id, document, highlights}` with `_formatted` stripped from `document` and moved to `highlights` (arrays of strings per field); `facetDistribution` maps to `{type: "value", values}` sorted by count desc; `facetStats` maps to `{type: "stats", min, max, count}` using the distribution total; `metadata` carries `skip`, `take`, `count` from `estimatedTotalHits`, `query`, `processing_time_ms`; missing facets give no `facets` key.
- [ ] **Step 2:** fail. **Step 3:** implement. **Step 4:** pass. **Step 5: Commit** `feat(search): meilisearch query and result translation`.

### Task 4: Index settings and synonyms (pure)

**Files:**
- Create: `apps/backend/src/providers/search-meilisearch/utils/settings.ts`, `synonyms.ts`
- Test: `apps/backend/src/__tests__/providers/search-meilisearch/settings.unit.spec.ts`

**Interfaces:**
- Produces: `buildSettings(index: SearchTypes.ResolvedSearchIndexDefinition): MeiliSettings` and `SYNONYMS: Record<string, string[]>` (Meilisearch format, each group listed under every member).

- [ ] **Step 1: Write failing tests**: `searchableAttributes` order follows the definition's `searchable.weight` descending, then field order (title, then others), non-searchable fields absent; `filterableAttributes` are the `filterable` fields (including non-retrievable `status` and `sales_channel_ids`); `sortableAttributes` the `sortable` ones; `displayedAttributes` are exactly the `retrievable` fields (so `status` and `sales_channel_ids` never return); `faceting.maxValuesPerFacet` 200 and `pagination.maxTotalHits` 10000; typo tolerance from `index.settings.typo_tolerance` (`enabled`, `minWordSizeForTypos {oneTypo, twoTypos}`, `disableOnAttributes`); `SYNONYMS` contains `ysl` with `yves saint laurent`, `edp` with `eau de parfum`, `edt` with `eau de toilette`, `100ml` with `3.4oz`, and every group is symmetric (each term lists the others).
- [ ] **Step 2:** fail. **Step 3:** implement; extend `SYNONYMS` with the common fragrance abbreviations (`cdg`, `mfk`, `jpg`, `d&g`, `ck`, `hermes`, `ml`/`oz` pairs for 30, 50, 100 ml). **Step 4:** pass. **Step 5: Commit** `feat(search): meilisearch settings and synonyms`.

### Task 5: Provider service, registration, integration test

**Files:**
- Create: `apps/backend/src/providers/search-meilisearch/index.ts` (`ModuleProvider(Modules.SEARCH, {services})`), `services/meilisearch-search.ts`
- Modify: `apps/backend/medusa-config.ts` (register `@medusajs/medusa/search` with `providers: [{ resolve: "./src/providers/search-meilisearch", id: "meilisearch", options: { host, apiKey, timeout: 3000 } }]` and `default_provider: "meilisearch"`; read `packages/modules/search/src/types/index.ts` first and keep the postgres provider registered as a second provider only if the module requires it)
- Test: `apps/backend/src/__tests__/providers/search-meilisearch/service.unit.spec.ts` (mocked client), `service.integration.spec.ts` (real server, skipped with a logged message when `MEILISEARCH_HOST` is unset)

**Interfaces:**
- Consumes: Tasks 2 to 4.
- Produces: class `MeilisearchSearchService extends AbstractSearchProviderService` with `static identifier = "meilisearch"` implementing `upsertIndex` (create index with primary key, apply `buildSettings` and `SYNONYMS`, wait for the task), `deleteIndex`, `listIndexes` (`{name, provider, document_count}`), `upsertDocuments`, `deleteDocuments` (filter to `deleteDocuments` by filter string, or by ids when the filter is a plain id list), `clearIndex`, `search`, `searchMany` (one multi-search call), `waitForTask` (poll to `succeeded`; throw on `failed` with the task error).

- [ ] **Step 1: Write failing unit tests** with a fake client: `upsertIndex` calls create, `updateSettings` with `buildSettings` output and `updateSynonyms`; `search` calls `toMeiliQuery` and returns `fromMeiliResponse`; client errors and timeouts become a `MedusaError` with fixed text and the original message only in the logger; `upsertDocuments` returns a task with an id and status `enqueued`; `waitForTask` throws on a failed task; `searchMany` issues one multi-search request and keeps result order.
- [ ] **Step 2:** fail. **Step 3:** implement the class and register it. **Step 4:** unit pass.
- [ ] **Step 5: Integration test** (needs Task 1 running): create a throwaway index with three documents, assert typo (`latafa` finds `Lattafa`), prefix (`lat`), synonym (`ysl` finds `Yves Saint Laurent`), facet counts, stats, filter with an injected quote returns no extra hits, delete by id, clear, cleanup. Run it.
- [ ] **Step 6:** `npx tsc --noEmit -p apps/backend` has no new errors. **Step 7: Commit** `feat(search): meilisearch search provider`.

### Task 6: Index fields, switch the index to Meilisearch, reindex live

**Files:**
- Modify: `apps/backend/src/search/product.ts` (add `sku: search.text().searchable({weight: 2}).array()` or the closest field kind the framework offers for an array of codes, `retrievable`; add graph field `variants.sku`; set `provider: "meilisearch"`; `settings.typo_tolerance { disabled_on_attributes: ["sku"] }`), `apps/backend/src/search/helpers/fragrance.ts` (add `toSkus(variants): string[]`, trimmed, unique, non-empty)
- Test: `apps/backend/src/__tests__/search/helpers/skus.unit.spec.ts` and extend `__tests__/search/product-document.unit.spec.ts`

**Interfaces:**
- Produces: documents carry `sku: string[]`. A search for `AI0079777` returns that product.

- [ ] **Step 1: Write failing tests**: `toSkus` trims, drops empty and duplicate values; `toDocument` includes `sku` for a two-variant product.
- [ ] **Step 2:** fail. **Step 3:** implement. **Step 4:** pass (`__tests__/search`).
- [ ] **Step 5 (live):** stop the backend; `npx medusa db:migrate --execute-safe-search`; start the backend and wait for the seed. Verify with `/store/search` (single-query body; pagination key is `take`; text is `filters.q`): `lattafa`, `latafa`, `khamrah`, `AI0079777`, `ysl`, `yves saint laurent`, `vanilla perfume`, `oud perfume`, `mens fragrance`, `fresh citrus`, `edp 100ml` each return at least one hit (record counts); category facet still shows the 7 department categories with the Phase 4 counts (Women 1561, Men 1260, Men's Sets 220, Women's Sets 207, Women's Body Mists 111, Men's Deodorants & Body Sprays 53, Unisex 19); `status` and `sales_channel_ids` never appear in a hit; stopping Meilisearch gives a clean error in under 4 s, then restart it. If a brief example finds nothing, report which field lacks the data (for example notes metadata is owner-supplied) rather than weakening the check.
- [ ] **Step 6: Commit** `feat(search): index sku, move product index to meilisearch`.

### Task 7: Search insights module and recording route

**Files:**
- Create: `apps/backend/src/modules/search-insights/{index.ts,service.ts,models/search-query.ts}` (+ generated migration), `apps/backend/src/workflows/record-search-query.ts`, `apps/backend/src/api/store/search/events/route.ts`, `apps/backend/src/api/store/search/events/validators.ts`
- Modify: `apps/backend/medusa-config.ts` (register module), `apps/backend/src/api/middlewares.ts` (body validation)
- Test: `apps/backend/src/__tests__/search-insights/normalize.unit.spec.ts`, `workflow` and route unit tests following the neighbouring review module's pattern

**Interfaces:**
- Produces: `normalizeQuery(raw: string): string | null` (trim, lowercase, collapse spaces, NFKC; null when under 3 or over 60 characters or only punctuation); model `search_query { id, query (unique), count, last_seen_at, results_count }`; `POST /store/search/events` body `{ query: string, results: number }` returning `{ ok: true }` always (200) so clients never retry-loop; the workflow upserts the row, incrementing `count`; per-IP rate limit of 30 events per minute (in-memory limiter, documented as single-instance).

- [ ] **Step 1: Write failing tests**: `normalizeQuery` cases (`"  Lattafa  "` becomes `lattafa`, `"ab"` null, 61 characters null, `"!!!"` null, `"Hermès"` stays `hermès`); recording `results: 0` is stored with `results_count 0` but never counted toward popular (assert in Task 8 query); route returns `{ok:true}` for invalid input without writing; the 31st event in a minute from one IP is ignored.
- [ ] **Step 2:** fail. **Step 3:** implement module, migration (`npx medusa db:generate searchInsights`, then `db:migrate`), workflow, route. **Step 4:** pass; `tsc` clean. **Step 5: Commit** `feat(search): record search queries`.

### Task 8: Popular and trending routes

**Files:**
- Create: `apps/backend/src/api/store/search/popular/route.ts`, `apps/backend/src/api/store/search/trending/route.ts`, `apps/backend/src/modules/search-insights/helpers/popular.ts`, `apps/backend/src/api/store/search/trending/helpers.ts`
- Test: `apps/backend/src/__tests__/search-insights/popular.unit.spec.ts`, `trending.unit.spec.ts`

**Interfaces:**
- Consumes: Task 7 model.
- Produces: `GET /store/search/popular` returns `{ queries: { query: string, count: number }[] }`: last 30 days, `count >= 2`, `results_count > 0`, top 8, sorted by count desc; `GET /store/search/trending?limit=8` returns `{ products: { id, title, handle, thumbnail }[] }`: top products by units on order line items in the last 14 days, falling back to newest published products when there are no orders; limit clamped 1 to 12. Both send `Cache-Control: public, max-age=300`.

- [ ] **Step 1: Write failing tests** for the pure rankers: popular excludes zero-result, count 1 and older than 30 days; ties break alphabetically; trending sums quantities by product, orders desc, falls back to newest when empty, clamps limit, excludes unpublished products.
- [ ] **Step 2:** fail. **Step 3:** implement helpers and routes (`query.graph` for order items and products). **Step 4:** pass. **Step 5 (live):** record three events through the route for one query twice and one once, then confirm `popular` lists only the twice-searched query; `trending` returns products. **Step 6: Commit** `feat(search): popular and trending routes`.

### Task 9: Storefront search libraries

**Files:**
- Create: `apps/storefront/src/lib/util/recent-searches.ts`, `apps/storefront/src/lib/util/highlight.tsx`, `apps/storefront/src/lib/util/combobox-nav.ts`, `apps/storefront/src/lib/data/search-insights.ts`
- Test: matching `*.test.ts(x)` beside each

**Interfaces:**
- Produces: `recent-searches`: `getRecentSearches(): string[]`, `addRecentSearch(q: string): string[]`, `removeRecentSearch`, `clearRecentSearches` (key `sc-recent-searches`, cap 8, newest first, case-insensitive dedupe, ignores queries under 2 characters, all storage access in try/catch). `highlight`: `renderHighlight(value: string, pre?: string, post?: string): ReactNode` converts Meilisearch highlight tags to `<mark>` elements without HTML injection, and treats `<script>` text as plain text. `combobox-nav`: `navReducer(state: {active: number, count: number}, action: "next" | "prev" | "first" | "last" | "reset" | {type: "count", count: number}): state` wrapping around, `-1` meaning the input. `search-insights`: `getPopularSearches(): Promise<string[] | null>`, `getTrendingProducts(): Promise<TrendingProduct[] | null>` (2.5 s abort timeout, null on any failure, `next: { revalidate: 300 }`), `trackSearch(query: string, results: number): void` (fire-and-forget `fetch` with `keepalive`, swallows errors).

- [ ] **Step 1: Write failing tests**: recent searches dedupe, cap, ordering, short-query rejection, and a throwing `localStorage`; highlight turns `<em>Lat</em>tafa` markers into a `<mark>` and leaves `<img onerror=x>` as text; reducer wraps both ways and handles count 0; data helpers return null on non-200 and on timeout.
- [ ] **Step 2:** fail. **Step 3:** implement. **Step 4:** pass. **Step 5: Commit** `feat(storefront): search libraries`.

### Task 10: Autocomplete overlay

**Files:**
- Modify: `apps/storefront/src/modules/layout/components/search/index.tsx`, `drawer.tsx`, `hit.tsx`; navbar usage unchanged except the trigger
- Create: `search/overlay.tsx` (combobox shell), `search/suggestions.tsx` (recent, popular, trending for empty input), `search/results-list.tsx` (products, brands, categories sections), `search/search-overlay.test.tsx`
- Update or delete the old `search-field.test.tsx` to match

**Interfaces:**
- Consumes: Task 9 libraries; the shared `searchClient`; `/store/search` with the `Configure` for 8 product hits, brand and category facet values for suggestion rows.
- Produces: an overlay with `role="combobox"`, `aria-controls`, `aria-activedescendant`, listbox rows; 200 ms debounce, superseded requests ignored; empty input shows recent (with remove and clear), popular and trending (a section with no data is not rendered); results rows show thumbnail, highlighted title, brand and price in the region currency using the existing price helper; Enter on a row navigates to it, Enter on the input records the search and goes to `/search?q=`; Escape closes and returns focus to the trigger; on viewports under 768 px the overlay is full-screen with a focus trap and body scroll lock; an error state shows "Search is unavailable right now. Please try again."

- [ ] **Step 1: Write failing component tests**: typing debounces to one request; arrow keys move `aria-activedescendant` across sections and wrap; Enter on the input calls the tracker and navigates; Escape closes; empty input renders recent searches from storage and hides popular when the fetch returned null; the error state renders on an adapter error; highlighted text is escaped.
- [ ] **Step 2:** fail. **Step 3:** implement. **Step 4:** pass; `npx tsc --noEmit` and `next lint` clean. **Step 5: Commit** `feat(storefront): autocomplete search overlay`.

### Task 11: `/search` results page

**Files:**
- Create: `apps/storefront/src/app/[countryCode]/(main)/search/page.tsx`, `apps/storefront/src/modules/search/templates/search-results.tsx`, test `search-results.test.tsx`
- Modify: reuse the Phase 4 filter drawer, sort, view toggle and pagination components from the store listing (read `modules/store` first and import them rather than copying); `robots` metadata `noindex`

**Interfaces:**
- Consumes: Task 9 `trackSearch`; shared `searchClient`.
- Produces: `/[countryCode]/search?q=...&page=...`; heading "Results for “q”" with the count; the same filters as `/store`; no-results state with a "check the spelling" hint plus popular searches; the query is rendered as text only; an empty `q` redirects to `/store`.

- [ ] **Step 1: Write failing tests**: the heading escapes `<b>x</b>`, an empty `q` redirects, no-results renders the hint, a result count of 0 is passed to `trackSearch`.
- [ ] **Step 2:** fail. **Step 3:** implement. **Step 4:** pass; lint and `tsc` clean. **Step 5: Commit** `feat(storefront): search results page`.

### Task 12: Docs, build, live and browser verification

**Files:**
- Create: `docs/storefront/SEARCH_ARCHITECTURE.md`
- Modify: `docs/storefront/IMPLEMENTATION_PLAN.md` (item 1 settled; Phase 6 done), `docs/storefront/TECH_STACK.md` (search row), `.env.template` files where missing

- [ ] **Step 1:** Run the whole backend and storefront unit suites; all green. Build the storefront from a sibling copy; zero lint `Error:` lines.
- [ ] **Step 2:** Rebuild and restart both apps (storefront `next start -p 8000`, backend `npx medusa develop`) with Meilisearch running. Run the Task 6 query list through the storefront's own request path, measure p95 over 50 typical queries (target under 200 ms; report the real number, whatever it is).
- [ ] **Step 3 (browser):** if Playwright or Chrome is available, drive the overlay: open, type `latafa`, arrow down, Enter, Escape, and a 390 px mobile viewport, and save screenshots to the scratchpad. If no browser can be launched, say so plainly in the doc and the report rather than claiming a check.
- [ ] **Step 4:** Write `SEARCH_ARCHITECTURE.md`: architecture diagram, env variables, how to run Meilisearch locally, how to edit `synonyms.ts`, reindex (`--execute-safe-search`), popular and trending data sources, error behaviour, and the real verification results including what was not checked.
- [ ] **Step 5: Commit** `docs(storefront): search architecture and verification`.
