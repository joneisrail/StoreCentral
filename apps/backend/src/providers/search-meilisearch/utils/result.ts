import type { SearchTypes } from "@medusajs/framework/types";
import {
  normalizeFacets,
  normalizePagination,
  resolveHighlight,
} from "./query";

/** The subset of a Meilisearch search response this provider reads. */
export interface MeiliResponse {
  hits: Record<string, any>[];
  query?: string;
  processingTimeMs?: number;
  limit?: number;
  offset?: number;
  estimatedTotalHits?: number;
  totalHits?: number;
  facetDistribution?: Record<string, Record<string, number>>;
  facetStats?: Record<string, { min: number; max: number }>;
}

/**
 * Translates a Meilisearch response into the provider contract's result.
 *
 * - `_formatted` is removed from each document. Meilisearch fills it with every
 *   retrieved field (stringified) whether or not it matched, so only the
 *   requested highlight fields whose value actually contains the highlight tag
 *   become `highlights`.
 * - Stats facets read `facetStats` (numeric facets only: min and max). `count`
 *   is the sum of that facet's `facetDistribution` (documents holding a value),
 *   falling back to the result's total count. Arrays of values count once per
 *   value, so it can exceed the document count for multi-valued fields.
 * - `provider_metadata.typo_tolerance_ignored` is set when the query asked for
 *   `typo_tolerance: false`, which Meilisearch only supports per index.
 */
export function fromMeiliResponse(
  response: MeiliResponse,
  input: SearchTypes.ProviderSearchQuery,
): SearchTypes.SearchResult {
  const options = input.search_options ?? {};
  const { skip, take } = normalizePagination(input.pagination);
  const count =
    options.count === "none"
      ? null
      : (response.estimatedTotalHits ?? response.totalHits ?? 0);
  const highlight = resolveHighlight(input);
  const primaryKey = input.index.primary_key ?? "id";

  const hits: SearchTypes.SearchHit[] = (response.hits ?? []).map((raw) => {
    const { _formatted, _rankingScore, ...document } = raw;

    const hit: SearchTypes.SearchHit = {
      id: String(document[primaryKey] ?? document.id),
      document,
    };

    if (options.include_score && typeof _rankingScore === "number") {
      hit.score = _rankingScore;
    }

    if (highlight && _formatted) {
      const highlights: Record<string, string[]> = {};
      const wildcard = highlight.fields.includes("*");
      for (const [field, value] of Object.entries(_formatted)) {
        if (!wildcard && !highlight.fields.includes(field)) {
          continue;
        }

        // Array fields come back as arrays of strings; keep the marked ones.
        const marked = (Array.isArray(value) ? value : [value]).filter(
          (v): v is string =>
            typeof v === "string" && v.includes(highlight.preTag),
        );
        if (marked.length) {
          highlights[field] = marked;
        }
      }
      if (Object.keys(highlights).length) {
        hit.highlights = highlights;
      }
    }

    return hit;
  });

  const facets: Record<string, SearchTypes.SearchFacetResult> = {};

  for (const request of normalizeFacets(options.facets)) {
    const distribution = response.facetDistribution?.[request.field];

    if (request.type === "stats") {
      const stats = response.facetStats?.[request.field];
      if (!stats) {
        continue;
      }

      facets[request.field] = {
        type: "stats",
        min: stats.min,
        max: stats.max,
        count: distribution
          ? Object.values(distribution).reduce((sum, n) => sum + n, 0)
          : (count ?? 0),
      };
      continue;
    }

    if (request.type === "range" || !distribution) {
      continue;
    }

    const needle = request.query?.toLowerCase();
    let values = Object.entries(distribution)
      .filter(([value]) => !needle || value.toLowerCase().includes(needle))
      .map(([value, n]) => ({ value, count: n }));

    values.sort(
      request.sort === "alpha"
        ? (a, b) => a.value.localeCompare(b.value)
        : (a, b) => b.count - a.count || a.value.localeCompare(b.value),
    );

    let otherCount: number | undefined;
    if (request.limit !== undefined && values.length > request.limit) {
      otherCount = values
        .slice(request.limit)
        .reduce((sum, v) => sum + v.count, 0);
      values = values.slice(0, request.limit);
    }

    facets[request.field] =
      otherCount === undefined
        ? { type: "value", values }
        : { type: "value", values, other_count: otherCount };
  }

  const result: SearchTypes.SearchResult = {
    hits,
    metadata: {
      skip,
      take,
      count,
      query: response.query ?? input.q,
      processing_time_ms: response.processingTimeMs,
    },
  };

  if (Object.keys(facets).length) {
    result.facets = facets;
  }

  if (options.typo_tolerance === false) {
    result.provider_metadata = { typo_tolerance_ignored: true };
  }

  return result;
}
