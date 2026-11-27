import { MedusaError } from "@medusajs/framework/utils";
import type { SearchTypes } from "@medusajs/framework/types";
import { buildSettings } from "../../../providers/search-meilisearch/utils/settings";
import { SYNONYMS } from "../../../providers/search-meilisearch/utils/synonyms";

type Field = SearchTypes.SearchFieldDefinition;

const keywordArray: Field = {
  type: "keyword",
  array: true,
  filterable: true,
  facetable: true,
};

function productIndex(
  overrides: Partial<SearchTypes.ResolvedSearchIndexDefinition> = {},
): SearchTypes.ResolvedSearchIndexDefinition {
  return {
    name: "products",
    entity: "product",
    primary_key: "id",
    provider: "meilisearch",
    physical_name: "products",
    definition_hash: "hash",
    seed: async function* () {},
    settings: {
      typo_tolerance: {
        enabled: true,
        min_word_size_for_one_typo: 4,
        min_word_size_for_two_typos: 8,
        disabled_on_attributes: ["handle"],
      },
    },
    fields: {
      id: { type: "keyword", filterable: true },
      status: { type: "keyword", filterable: true, retrievable: false },
      sales_channel_ids: {
        type: "keyword",
        array: true,
        filterable: true,
        retrievable: false,
      },
      title: { type: "text", searchable: { weight: 3 }, sortable: true },
      description: { type: "text", searchable: { weight: 1 } },
      handle: { type: "keyword" },
      thumbnail: { type: "keyword" },
      created_at: { type: "date", sortable: true },
      category: keywordArray,
      option_values: {
        ...keywordArray,
        searchable: { weight: 2 },
      },
      brand: { ...keywordArray, searchable: true },
      in_stock: { type: "boolean", filterable: true, facetable: true },
      min_price_usd: {
        type: "float",
        filterable: true,
        sortable: true,
        facetable: { types: ["stats"] },
      },
      original_price_usd: { type: "float" },
    },
    ...overrides,
  };
}

describe("buildSettings", () => {
  const settings = buildSettings(productIndex());

  it("orders searchable attributes by weight, then declared order", () => {
    expect(settings.searchableAttributes).toEqual([
      "title",
      "option_values",
      "description",
      "brand",
    ]);
  });

  it("uses filterable fields, including non-retrievable ones", () => {
    expect(settings.filterableAttributes).toEqual([
      "id",
      "status",
      "sales_channel_ids",
      "category",
      "option_values",
      "brand",
      "in_stock",
      "min_price_usd",
    ]);
  });

  it("uses sortable fields", () => {
    expect(settings.sortableAttributes).toEqual([
      "title",
      "created_at",
      "min_price_usd",
    ]);
  });

  it("displays exactly the retrievable fields", () => {
    expect(settings.displayedAttributes).toEqual([
      "id",
      "title",
      "description",
      "handle",
      "thumbnail",
      "created_at",
      "category",
      "option_values",
      "brand",
      "in_stock",
      "min_price_usd",
      "original_price_usd",
    ]);
    expect(settings.displayedAttributes).not.toContain("status");
    expect(settings.displayedAttributes).not.toContain("sales_channel_ids");
  });

  it("always displays the primary key", () => {
    const result = buildSettings(
      productIndex({
        primary_key: "sku",
        fields: {
          sku: { type: "keyword", retrievable: false },
          title: { type: "text", searchable: true },
        },
      }),
    );
    expect(result.displayedAttributes).toEqual(["sku", "title"]);
  });

  it("rejects an index with no searchable fields", () => {
    const build = () =>
      buildSettings(
        productIndex({
          fields: { id: { type: "keyword", filterable: true } },
        }),
      );
    expect(build).toThrow(MedusaError);
    expect(build).toThrow(/products.*no searchable fields/);
  });

  it("hides every child of a non-retrievable object container", () => {
    const result = buildSettings(
      productIndex({
        fields: {
          id: { type: "keyword" },
          title: { type: "text", searchable: true },
          internal: {
            type: "object",
            retrievable: false,
            fields: {
              note: { type: "keyword", filterable: true },
              own: { type: "keyword", retrievable: true },
            },
          },
        },
      }),
    );
    expect(result.displayedAttributes).toEqual(["id", "title"]);
    expect(result.filterableAttributes).toEqual(["internal.note"]);
  });

  it("sets faceting and pagination limits", () => {
    expect(settings.faceting).toEqual({
      maxValuesPerFacet: 200,
      sortFacetValuesBy: { "*": "count" },
    });
    expect(settings.pagination).toEqual({ maxTotalHits: 10000 });
  });

  it("translates typo tolerance", () => {
    expect(settings.typoTolerance).toEqual({
      enabled: true,
      minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 },
      disableOnAttributes: ["handle"],
    });
  });

  it("falls back to Meilisearch defaults without typo settings", () => {
    const result = buildSettings(productIndex({ settings: {} }));
    expect(result.typoTolerance).toEqual({
      enabled: true,
      disableOnAttributes: [],
    });
  });

  it("flattens nested object fields to dotted paths", () => {
    const result = buildSettings(
      productIndex({
        fields: {
          id: { type: "keyword" },
          meta: {
            type: "object",
            fields: {
              color: { type: "keyword", filterable: true, searchable: true },
              secret: { type: "keyword", retrievable: false },
            },
          },
        },
      }),
    );
    expect(result.searchableAttributes).toEqual(["meta.color"]);
    expect(result.filterableAttributes).toEqual(["meta.color"]);
    expect(result.displayedAttributes).toEqual(["id", "meta.color"]);
  });

  it("does not include synonyms", () => {
    expect(settings).not.toHaveProperty("synonyms");
  });
});

describe("SYNONYMS", () => {
  it("maps the fragrance abbreviations", () => {
    expect(SYNONYMS.ysl).toContain("yves saint laurent");
    expect(SYNONYMS.edp).toContain("eau de parfum");
    expect(SYNONYMS.edt).toContain("eau de toilette");
    expect(SYNONYMS["100ml"]).toContain("3.4oz");
  });

  it("lists every group under every member, symmetrically", () => {
    for (const [term, others] of Object.entries(SYNONYMS)) {
      expect(others).not.toContain(term);
      expect(new Set(others).size).toBe(others.length);
      for (const other of others) {
        const back = SYNONYMS[other];
        expect(back).toBeDefined();
        expect([term, ...others.filter((o) => o !== other)].sort()).toEqual(
          [...back].sort(),
        );
      }
    }
  });

  it("uses lowercase, trimmed terms only", () => {
    for (const [term, others] of Object.entries(SYNONYMS)) {
      for (const t of [term, ...others]) {
        expect(t).toBe(t.toLowerCase());
        expect(t).toBe(t.trim());
      }
    }
  });
});
