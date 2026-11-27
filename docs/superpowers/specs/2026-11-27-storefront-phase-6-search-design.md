# Storefront Phase 6: Advanced Search Engine (Meilisearch)

Brief: `apps/storefront/CLAUDE.md`, Phase 6. Decision record: `docs/storefront/IMPLEMENTATION_PLAN.md` item 1, now settled as option (b).

## Why

A spike on the live backend (3,431 products, built-in Postgres search) showed:

| Query | Built-in result |
|---|---|
| `lattafa`, `lat`, `khamra`, `ysl`, `vanilla`, `oud` | works (prefix match) |
| `latafa` (typo) | 0 hits: no typo tolerance |
| `AI0079777` (SKU) | 0 hits: SKU not indexed |
| `yves saint laurent` | 0 hits: no synonyms, brand not searchable |
| `fresh citrus`, `edp 100ml` | 0 hits: notes, family, concentration, size not searchable |

Indexing more fields fixes the SKU, notes and family rows. Typos and synonyms (brief items 7 and 12) need a real engine. Decision (owner, "take all recommended"): add Meilisearch.

## Goal

Typing in the storefront finds the right fragrance despite typos, abbreviations and partial words, shows rich suggestions instantly, and remembers and ranks what shoppers search for. Success means every example search in the brief returns sensible results and the acceptance checks below pass.

## Architecture

```
Medusa product events -> Search Module (existing consume / seed / catch-up)
                              |  provider = "meilisearch"
                              v
                 Meilisearch provider (new, backend)
                              |
   /store/search (existing contract, unchanged) <- Next.js storefront
```

- **No browser access to Meilisearch.** The storefront keeps calling `/store/search` through the existing InstantSearch adapter. The master key lives only in backend env (`MEILISEARCH_HOST`, `MEILISEARCH_API_KEY`). This meets "never expose the master key".
- **Indexing lifecycle is already owned by the Search Module**: created and updated products are re-indexed from events, `product.deleted` removes documents, and a catch-up pass repairs misses. We add only the provider. Full reindex is `npx medusa db:migrate --execute-safe-search`, documented in `docs/storefront/SEARCH_ARCHITECTURE.md`. Provider writes return Meilisearch task ids and implement `waitForTask`; a failed task throws so the module's error handling and logs see it.
- **Provider** at `apps/backend/src/providers/search-meilisearch/`, a class extending `AbstractSearchProviderService` (`identifier = "meilisearch"`), registered in `medusa-config.ts` under the search module `providers`, and `product.ts` selects it. Implements every method of `ISearchProvider` plus `searchMany` (one multi-search round-trip) and `waitForTask`. The exact registration shape is verified against `packages/modules/search` in the first plan task.
- **Translation layer** (pure, unit-tested without a server): filter DSL to Meilisearch filter strings (`$eq $ne $in $nin $lt..$gte $exists $contains $overlaps $prefix`, `$and/$or/$not`), facets and facet stats, `match_strategy` to `matchingStrategy`, `typo_tolerance` flag, highlight with `pre_tag`/`post_tag`, pagination (`skip`/`take`, `order` to `sort`), `count`. Unsupported combinations throw a clear error at migrate or request time rather than returning wrong results.
- **Index changes** in `src/search/product.ts`: add searchable `sku` (all variant SKUs), plus the existing brand, notes, fragrance family, gender, concentration, category and option values. A schema change means the `--execute-safe-search` rebuild documented in Phase 4.
- **Meilisearch settings**, written on `upsertIndex`: ranked `searchableAttributes` (title, brand, sku, notes, fragrance_family, concentration, category, option_values, description); typo tolerance on, with `sku` excluded from typo matching; prefix search on; synonyms from `src/providers/search-meilisearch/synonyms.ts` (owner-editable: `ysl` = `yves saint laurent`, `edp` = `eau de parfum`, `edt` = `eau de toilette`, `100ml` = `3.4oz`, `cdg`, `mfk`, `jpg` and similar); filterable, sortable and facetable from the field definitions; `faceting.maxValuesPerFacet` 200.
- **Dev and deploy**: Meilisearch is not installed here and Docker is absent. Dev runs the official Windows binary (downloaded in a plan task, data dir git-ignored). `docker-compose` gets a `meilisearch` service with a volume. `.env.template` documents the two variables. Production hosting is Phase 13.

## Storefront

Replaces the navbar search drawer (`modules/layout/components/search`); the `/store` listing keeps its filters.

1. **Autocomplete overlay**: opens from the navbar icon; full-screen on mobile, anchored panel on desktop. Input debounced at 200 ms, request cancelled when superseded, results cached per query by the adapter. Sections: product suggestions (thumbnail, title with highlighted match, brand, price, quick link), matching brands, matching categories. A "See all results for ..." row goes to `/search?q=`.
2. **Empty-input state**: recent searches (browser `localStorage`, cap 8, clearable, per-visitor), popular searches and trending products from the backend.
3. **Keyboard and accessibility**: ARIA combobox/listbox, Up and Down move through every row across sections, Enter opens the row or runs the search, Escape closes and returns focus, focus trap in the mobile overlay.
4. **`/search` page**: server-rendered shell with the query in the URL, results grid and the Phase 4 filter drawer, sort, view toggle, pagination, no-results state with suggestions. `noindex`.
5. **Highlighting** from provider `highlight` output, escaped before render (never `dangerouslySetInnerHTML` with raw tags: tags are converted to elements).

## Popular searches and trending products (real data, no mocks)

- **Search insights module** (`src/modules/search-insights`): one model, `search_query` (normalised query, count, last_seen, results_count bucket). `POST /store/search/events` records a submitted search (rate-limited, query length capped, ignores empty and zero-result noise below a threshold), via a workflow as the project rules require.
- `GET /store/search/popular`: top queries of the last 30 days with at least 2 searches and results, public, `Cache-Control: public, max-age=300`.
- `GET /store/search/trending`: products by units sold in the last 14 days from order line items, in the shopper's sales channel, falling back to newest products when there are no recent orders.
- A section with no data is hidden, never faked.

## Error handling

- Meilisearch down or slow: the provider times out (3 s) and `/store/search` returns the module's error; the overlay shows "Search is unavailable right now" and the `/store` listing keeps working from its server fetch fallback where one exists. Search never blocks checkout or browsing.
- Search events are fire-and-forget; a failure is swallowed client-side and logged server-side.

## Testing and acceptance

- Unit: filter and facet translation, synonym file shape, settings builder, recent-searches store, highlight renderer, keyboard-navigation reducer.
- Integration: provider against a real local Meilisearch (skipped with a clear message when `MEILISEARCH_HOST` is unset).
- Live checks on the 3,431-product catalogue: each brief example (`Lattafa`, `Khamrah`, `Vanilla perfume`, `Oud perfume`, `Men's fragrance`, `Fresh citrus`, `YSL`, `EDP 100ml`), the typo `latafa`, the SKU `AI0079777`, `yves saint laurent`; facet counts match the Phase 4 numbers; p95 of 50 typical queries under 200 ms locally.
- Browser: keyboard path and mobile overlay checked in a real browser this phase (Phase 4 and 5 left this unchecked).

## Out of scope

Semantic or vector search, personalised ranking, multi-language, an admin UI for synonyms (the file is edited in code), analytics dashboards beyond the two public routes, production Meilisearch hosting (Phase 13).

## Docs

`docs/storefront/SEARCH_ARCHITECTURE.md`: architecture, env, synonym editing, reindex procedure, verification results.
