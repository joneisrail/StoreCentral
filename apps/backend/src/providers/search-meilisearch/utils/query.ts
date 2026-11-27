import type { SearchTypes } from "@medusajs/framework/types";
import { MedusaError } from "@medusajs/framework/utils";
import { toMeiliFilter } from "./filters";

export const MAX_QUERY_LENGTH = 200;
export const DEFAULT_TAKE = 20;
export const MAX_TAKE = 100;
export const DEFAULT_PRE_TAG = "<mark>";
export const DEFAULT_POST_TAG = "</mark>";

const FIELD_NAME = /^[A-Za-z0-9_.]+$/;

/** The subset of Meilisearch search parameters this provider sends. */
export interface MeiliSearchParams {
  q: string;
  offset: number;
  limit: number;
  matchingStrategy: "all" | "last";
  attributesToRetrieve: string[];
  filter?: string;
  sort?: string[];
  facets?: string[];
  attributesToHighlight?: string[];
  highlightPreTag?: string;
  highlightPostTag?: string;
  attributesToCrop?: string[];
  cropLength?: number;
  showRankingScore?: boolean;
  rankingScoreThreshold?: number;
  distinct?: string;
  attributesToSearchOn?: string[];
  locales?: string[];
}

function invalid(message: string): never {
  throw new MedusaError(MedusaError.Types.INVALID_DATA, message);
}

/**
 * Trims the free-text query and caps it at 200 characters. Missing, empty and
 * whitespace-only queries become "", which Meilisearch answers with every
 * document (the /store listing relies on this). Never throws.
 */
export function normalizeQuery(q: unknown): string {
  if (typeof q !== "string") {
    return "";
  }

  return q.trim().slice(0, MAX_QUERY_LENGTH);
}

/** Resolves skip/take with defaults (0 and 20) and the `take` cap of 100. */
export function normalizePagination(
  pagination: SearchTypes.SearchPagination | undefined,
): { skip: number; take: number } {
  const skip = Math.max(0, Math.floor(pagination?.skip ?? 0));
  const take = Math.min(
    MAX_TAKE,
    Math.max(0, Math.floor(pagination?.take ?? DEFAULT_TAKE)),
  );

  return { skip, take };
}

/** The request's facets with the bare-string shorthand expanded. */
export function normalizeFacets(
  facets: SearchTypes.SearchOptions["facets"],
): SearchTypes.SearchFacetRequest[] {
  return (facets ?? []).map((facet) =>
    typeof facet === "string" ? { field: facet, type: "value" } : facet,
  );
}

/**
 * Resolves the highlight request. Highlighting only applies with a free-text
 * query, matching the contract. Tags default to <mark></mark> only when the
 * request supplied none.
 */
export function resolveHighlight(input: SearchTypes.ProviderSearchQuery): {
  fields: string[];
  preTag: string;
  postTag: string;
  snippet?: boolean | { length: number };
} | null {
  const highlight = input.search_options?.highlight;

  if (!highlight || !normalizeQuery(input.q)) {
    return null;
  }

  if (highlight === true) {
    return { fields: ["*"], preTag: DEFAULT_PRE_TAG, postTag: DEFAULT_POST_TAG };
  }

  return {
    fields: highlight.fields?.length ? highlight.fields : ["*"],
    preTag: highlight.pre_tag ?? DEFAULT_PRE_TAG,
    postTag: highlight.post_tag ?? DEFAULT_POST_TAG,
    snippet: highlight.snippet,
  };
}

/**
 * Translates a provider search query into a Meilisearch search request.
 *
 * Mappings worth knowing:
 * - `match_strategy`: Meilisearch offers `last`, `all` and `frequency`. `all`
 *   maps to `all`, `last` to `last`, and `any` to `last` (the closest
 *   available: it drops trailing terms until something matches). The contract
 *   default is `all`, so it is sent explicitly; Meilisearch's own is `last`.
 * - `typo_tolerance: false` is NOT sent. Meilisearch configures typo tolerance
 *   per index, not per query, so the provider reports it through
 *   `provider_metadata.typo_tolerance_ignored` (see fromMeiliResponse).
 * - Range facets, vector search and cursors are rejected, never approximated.
 * - The primary key is appended to `attributesToRetrieve` when absent so a hit
 *   always carries its id.
 * - Facet `stats` fields go into `facets`; fromMeiliResponse reads
 *   `facetStats` for them based on the same input.
 */
export function toMeiliQuery(input: SearchTypes.ProviderSearchQuery): {
  indexUid: string;
  params: MeiliSearchParams;
} {
  const options = input.search_options ?? {};

  if (input.pagination?.cursor) {
    invalid("Meilisearch does not support cursor pagination; use skip and take.");
  }

  if (options.vector) {
    invalid("The Meilisearch provider does not support vector search.");
  }

  const { skip, take } = normalizePagination(input.pagination);

  const attributesToRetrieve = [...(input.attributes_to_retrieve ?? [])];
  const primaryKey = input.index.primary_key;
  if (
    primaryKey &&
    !attributesToRetrieve.includes("*") &&
    !attributesToRetrieve.includes(primaryKey)
  ) {
    attributesToRetrieve.push(primaryKey);
  }

  const params: MeiliSearchParams = {
    q: normalizeQuery(input.q),
    offset: skip,
    limit: take,
    matchingStrategy: options.match_strategy === undefined || options.match_strategy === "all" ? "all" : "last",
    attributesToRetrieve,
  };

  const filter = toMeiliFilter(input.filters);
  if (filter !== undefined) {
    params.filter = filter;
  }

  const sort: string[] = [];
  for (const [field, direction] of Object.entries(input.pagination?.order ?? {})) {
    if (field === "_score") {
      continue; // relevance is Meilisearch's default order
    }

    if (!FIELD_NAME.test(field)) {
      invalid(`Cannot sort by "${field}": invalid field name.`);
    }

    sort.push(`${field}:${direction === "DESC" ? "desc" : "asc"}`);
  }
  if (sort.length) {
    params.sort = sort;
  }

  const facets: string[] = [];
  for (const facet of normalizeFacets(options.facets)) {
    if (facet.type === "range") {
      invalid(`Range facets are not supported by Meilisearch (field "${facet.field}").`);
    }

    if (!facets.includes(facet.field)) {
      facets.push(facet.field);
    }
  }
  if (facets.length) {
    params.facets = facets;
  }

  const highlight = resolveHighlight(input);
  if (highlight) {
    params.attributesToHighlight = highlight.fields;
    params.highlightPreTag = highlight.preTag;
    params.highlightPostTag = highlight.postTag;

    if (highlight.snippet) {
      params.attributesToCrop = highlight.fields;
      if (typeof highlight.snippet === "object") {
        params.cropLength = highlight.snippet.length;
      }
    }
  }

  if (options.include_score) {
    params.showRankingScore = true;
  }

  if (options.min_score !== undefined) {
    params.rankingScoreThreshold = options.min_score;
  }

  if (options.distinct) {
    params.distinct = options.distinct;
  }

  if (options.attributes_to_search_on?.length) {
    params.attributesToSearchOn = options.attributes_to_search_on;
  }

  if (options.locales?.length) {
    params.locales = options.locales;
  }

  return { indexUid: input.index.physical_name, params };
}
