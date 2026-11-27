import { fromMeiliResponse } from "../../../providers/search-meilisearch/utils/result";

function input(overrides: Record<string, any> = {}): any {
  return {
    index: { name: "products", physical_name: "dev_products_v1", primary_key: "id" },
    attributes_to_retrieve: ["id", "title"],
    ...overrides,
  };
}

describe("fromMeiliResponse", () => {
  it("maps hits, strips _formatted into highlights and fills metadata", () => {
    const result = fromMeiliResponse(
      {
        hits: [
          {
            id: "1",
            title: "Dior Sauvage",
            price: 100,
            _formatted: { id: "1", title: "<mark>Dior</mark> Sauvage", price: "100" },
          },
        ],
        query: "dior",
        processingTimeMs: 14,
        limit: 12,
        offset: 24,
        estimatedTotalHits: 40,
      },
      input({ q: "dior", pagination: { skip: 24, take: 12 }, search_options: { highlight: { fields: ["title"] } } }),
    );
    expect(result).toEqual({
      hits: [
        {
          id: "1",
          document: { id: "1", title: "Dior Sauvage", price: 100 },
          highlights: { title: ["<mark>Dior</mark> Sauvage"] },
        },
      ],
      metadata: { skip: 24, take: 12, count: 40, query: "dior", processing_time_ms: 14 },
    });
    expect(result).not.toHaveProperty("facets");
    expect(result.hits[0]).not.toHaveProperty("score");
  });

  it("omits highlights when none were requested and strips _formatted", () => {
    const result = fromMeiliResponse(
      { hits: [{ id: "1", title: "A", _formatted: { id: "1", title: "A" } }], estimatedTotalHits: 1, processingTimeMs: 1 },
      input(),
    );
    expect(result.hits[0]).toEqual({ id: "1", document: { id: "1", title: "A" } });
  });

  it("only reports highlights for fields that matched", () => {
    const result = fromMeiliResponse(
      {
        hits: [{ id: "1", title: "A", brand: "B", _formatted: { id: "1", title: "<b>A</b>", brand: "B" } }],
        estimatedTotalHits: 1,
        processingTimeMs: 1,
      },
      input({
        q: "a",
        search_options: { highlight: { fields: ["title", "brand"], pre_tag: "<b>", post_tag: "</b>" } },
      }),
    );
    expect(result.hits[0].highlights).toEqual({ title: ["<b>A</b>"] });
  });

  it("returns the score only when include_score is set", () => {
    const response = { hits: [{ id: "1", _rankingScore: 0.9 }], estimatedTotalHits: 1, processingTimeMs: 1 };
    expect(fromMeiliResponse(response, input({ search_options: { include_score: true } })).hits[0]).toEqual({
      id: "1",
      score: 0.9,
      document: { id: "1" },
    });
    expect(fromMeiliResponse(response, input()).hits[0]).toEqual({ id: "1", document: { id: "1" } });
  });

  it("reads the id from the primary key and stringifies it", () => {
    const result = fromMeiliResponse(
      { hits: [{ sku: 7, id: "other" }], estimatedTotalHits: 1, processingTimeMs: 1 },
      input({ index: { physical_name: "x", primary_key: "sku" } }),
    );
    expect(result.hits[0].id).toBe("7");
  });

  it("maps value facets sorted by count desc, then value", () => {
    const result = fromMeiliResponse(
      { hits: [], estimatedTotalHits: 5, processingTimeMs: 1, facetDistribution: { brand: { Chanel: 1, Dior: 3, Armani: 1 } } },
      input({ search_options: { facets: ["brand"] } }),
    );
    expect(result.facets).toEqual({
      brand: {
        type: "value",
        values: [
          { value: "Dior", count: 3 },
          { value: "Armani", count: 1 },
          { value: "Chanel", count: 1 },
        ],
      },
    });
  });

  it("applies facet limit, alpha sort and reports other_count", () => {
    const response = {
      hits: [],
      estimatedTotalHits: 5,
      processingTimeMs: 1,
      facetDistribution: { brand: { Chanel: 1, Dior: 3, Armani: 2 } },
    };
    expect(
      fromMeiliResponse(response, input({ search_options: { facets: [{ field: "brand", limit: 1 }] } })).facets!.brand,
    ).toEqual({ type: "value", values: [{ value: "Dior", count: 3 }], other_count: 3 });
    expect(
      fromMeiliResponse(response, input({ search_options: { facets: [{ field: "brand", sort: "alpha" }] } })).facets!
        .brand,
    ).toEqual({
      type: "value",
      values: [
        { value: "Armani", count: 2 },
        { value: "Chanel", count: 1 },
        { value: "Dior", count: 3 },
      ],
    });
  });

  it("maps stats facets using the distribution total as count", () => {
    const result = fromMeiliResponse(
      {
        hits: [],
        estimatedTotalHits: 9,
        processingTimeMs: 1,
        facetDistribution: { price: { "100": 2, "80": 1 } },
        facetStats: { price: { min: 80, max: 100 } },
      },
      input({ search_options: { facets: [{ field: "price", type: "stats" }] } }),
    );
    expect(result.facets).toEqual({ price: { type: "stats", min: 80, max: 100, count: 3 } });
  });

  it("falls back to the hit count for stats without a distribution, and skips missing stats", () => {
    const result = fromMeiliResponse(
      { hits: [], estimatedTotalHits: 9, processingTimeMs: 1, facetStats: { price: { min: 1, max: 2 } } },
      input({
        search_options: {
          facets: [
            { field: "price", type: "stats" },
            { field: "weight", type: "stats" },
          ],
        },
      }),
    );
    expect(result.facets).toEqual({ price: { type: "stats", min: 1, max: 2, count: 9 } });
  });

  it("returns count null for count none", () => {
    const result = fromMeiliResponse(
      { hits: [], estimatedTotalHits: 9, processingTimeMs: 1 },
      input({ search_options: { count: "none" } }),
    );
    expect(result.metadata.count).toBeNull();
  });

  it("defaults skip/take and reports ignored typo tolerance", () => {
    const result = fromMeiliResponse(
      { hits: [], processingTimeMs: 2 },
      input({ q: "dior", search_options: { typo_tolerance: false } }),
    );
    expect(result.metadata).toEqual({ skip: 0, take: 20, count: 0, query: "dior", processing_time_ms: 2 });
    expect(result.provider_metadata).toEqual({ typo_tolerance_ignored: true });
  });

  it("has no provider_metadata otherwise", () => {
    expect(fromMeiliResponse({ hits: [], processingTimeMs: 1 }, input())).not.toHaveProperty("provider_metadata");
  });
});
