import type { Hit } from "instantsearch.js"

import type { TrendingProduct } from "@lib/data/search-insights"
import type { HitPricing } from "@modules/store/components/store-hits/price"

export type ProductHit = Hit<
  {
    title: string | null
    handle: string | null
    thumbnail: string | null
    brand?: string[]
  } & HitPricing
>

/**
 * One selectable row of the listbox. Every row is a link; `record` is the
 * query a selection records as a recent search.
 */
type RowBase = { id: string; href: string; record?: string }

export type Row =
  | (RowBase & { kind: "recent" | "popular"; query: string })
  | (RowBase & { kind: "trending"; product: TrendingProduct })
  | (RowBase & { kind: "product"; hit: ProductHit })
  | (RowBase & { kind: "brand" | "category"; value: string })
  | (RowBase & { kind: "all"; query: string })

export type Section = { key: string; title: string; rows: Row[] }

/** Popular and trending data from the server; null hides a section. */
export type SearchInsights = {
  popular: string[] | null
  trending: TrendingProduct[] | null
}

export const MAX_FACET_ROWS = 3

export const searchHref = (q: string) => `/search?q=${encodeURIComponent(q)}`

/** The `/store` listing filtered to one facet value, in its routing format. */
export const refinementHref = (attribute: string, value: string) =>
  `/store?${new URLSearchParams({ [`refinementList[${attribute}][0]`]: value })}`

const rowId = (prefix: string, section: string, index: number) =>
  `${prefix}-${section}-${index}`

export function suggestionSections(
  prefix: string,
  data: SearchInsights & { recent: string[] }
): Section[] {
  const sections: Section[] = [
    {
      key: "recent",
      title: "Recent searches",
      rows: data.recent.map((query, i) => ({
        kind: "recent" as const,
        id: rowId(prefix, "recent", i),
        href: searchHref(query),
        record: query,
        query,
      })),
    },
    {
      key: "popular",
      title: "Popular searches",
      rows: (data.popular ?? []).map((query, i) => ({
        kind: "popular" as const,
        id: rowId(prefix, "popular", i),
        href: searchHref(query),
        record: query,
        query,
      })),
    },
    {
      key: "trending",
      title: "Trending now",
      rows: (data.trending ?? [])
        .filter((p) => p.handle)
        .map((product, i) => ({
          kind: "trending" as const,
          id: rowId(prefix, "trending", i),
          href: `/products/${product.handle}`,
          product,
        })),
    },
  ]
  return sections.filter((s) => s.rows.length > 0)
}

type FacetData = { name: string; data?: Record<string, number> }

/**
 * Facet values for one attribute, those containing the query first, then by
 * count. They come from the same response as the product hits.
 */
export function facetValues(
  facets: FacetData[] | undefined,
  attribute: string,
  query: string
): string[] {
  const data = facets?.find((f) => f?.name === attribute)?.data ?? {}
  const q = query.trim().toLowerCase()
  const matches = (v: string) => (q && v.toLowerCase().includes(q) ? 0 : 1)
  return Object.entries(data)
    .filter(([value, count]) => value && count > 0)
    .sort(([a, ca], [b, cb]) => matches(a) - matches(b) || cb - ca)
    .slice(0, MAX_FACET_ROWS)
    .map(([value]) => value)
}

export function resultSections(
  prefix: string,
  data: { query: string; hits: ProductHit[]; facets?: FacetData[] }
): Section[] {
  const { query } = data
  const facetRows = (attribute: "brand" | "category") =>
    facetValues(data.facets, attribute, query).map((value, i) => ({
      kind: attribute,
      id: rowId(prefix, attribute, i),
      href: refinementHref(attribute, value),
      record: query,
      value,
    }))

  const sections: Section[] = [
    {
      key: "product",
      title: "Products",
      rows: data.hits
        .filter((hit) => hit.handle)
        .map((hit, i) => ({
          kind: "product" as const,
          id: rowId(prefix, "product", i),
          href: `/products/${hit.handle}`,
          record: query,
          hit,
        })),
    },
    { key: "brand", title: "Brands", rows: facetRows("brand") },
    { key: "category", title: "Categories", rows: facetRows("category") },
    {
      key: "all",
      title: "",
      rows: [
        {
          kind: "all",
          id: rowId(prefix, "all", 0),
          href: searchHref(query),
          record: query,
          query,
        },
      ],
    },
  ]
  return sections.filter((s) => s.rows.length > 0)
}
