import type { SearchTypes } from "@medusajs/framework/types";

/** The subset of Meilisearch index settings this provider manages. */
export interface MeiliSettings {
  searchableAttributes: string[];
  filterableAttributes: string[];
  sortableAttributes: string[];
  displayedAttributes: string[];
  faceting: {
    maxValuesPerFacet: number;
    sortFacetValuesBy: Record<string, "count" | "alpha">;
  };
  pagination: { maxTotalHits: number };
  typoTolerance: {
    enabled: boolean;
    minWordSizeForTypos?: { oneTypo?: number; twoTypos?: number };
    disableOnAttributes: string[];
  };
}

type Field = SearchTypes.SearchFieldDefinition;

interface FlatField {
  path: string;
  field: Field;
}

/**
 * Leaf fields by dotted path, in declared order. Object containers are not
 * attributes themselves; their children are.
 */
function flatten(fields: Record<string, Field>, prefix = ""): FlatField[] {
  return Object.entries(fields).flatMap(([name, field]) => {
    const path = `${prefix}${name}`;
    if (field.type === "object") {
      return flatten(field.fields ?? {}, `${path}.`);
    }
    return [{ path, field }];
  });
}

function weightOf(field: Field): number | undefined {
  const { searchable } = field;
  if (!searchable) {
    return undefined;
  }
  return typeof searchable === "object" ? (searchable.weight ?? 1) : 1;
}

/** Vectors are not returned unless explicitly asked for, like the module. */
function isRetrievable(field: Field): boolean {
  return field.type === "vector"
    ? field.retrievable === true
    : field.retrievable !== false;
}

/**
 * Builds the Meilisearch index settings for a resolved index definition.
 * Synonyms are not part of it: the provider applies them separately.
 *
 * Meilisearch ranks matches by attribute order, so searchable attributes go by
 * weight descending, then declared order (the sort is stable).
 */
export function buildSettings(
  index: SearchTypes.ResolvedSearchIndexDefinition,
): MeiliSettings {
  const flat = flatten(index.fields);
  // Vectors are matched by embedders, never as attributes.
  const scalar = flat.filter(({ field }) => field.type !== "vector");

  const searchableAttributes = scalar
    .filter(({ field }) => weightOf(field) !== undefined)
    .sort((a, b) => weightOf(b.field)! - weightOf(a.field)!)
    .map(({ path }) => path);

  const displayedAttributes = flat
    .filter(({ field }) => isRetrievable(field))
    .map(({ path }) => path);
  if (!displayedAttributes.includes(index.primary_key)) {
    displayedAttributes.unshift(index.primary_key);
  }

  const typo = index.settings?.typo_tolerance ?? {};
  const typoTolerance: MeiliSettings["typoTolerance"] = {
    enabled: typo.enabled ?? true,
    disableOnAttributes: typo.disabled_on_attributes ?? [],
  };
  if (
    typo.min_word_size_for_one_typo !== undefined ||
    typo.min_word_size_for_two_typos !== undefined
  ) {
    typoTolerance.minWordSizeForTypos = {
      ...(typo.min_word_size_for_one_typo !== undefined && {
        oneTypo: typo.min_word_size_for_one_typo,
      }),
      ...(typo.min_word_size_for_two_typos !== undefined && {
        twoTypos: typo.min_word_size_for_two_typos,
      }),
    };
  }

  return {
    searchableAttributes,
    filterableAttributes: scalar
      .filter(({ field }) => field.filterable)
      .map(({ path }) => path),
    sortableAttributes: scalar
      .filter(({ field }) => field.sortable)
      .map(({ path }) => path),
    displayedAttributes,
    faceting: { maxValuesPerFacet: 200, sortFacetValuesBy: { "*": "count" } },
    pagination: { maxTotalHits: 10000 },
    typoTolerance,
  };
}
