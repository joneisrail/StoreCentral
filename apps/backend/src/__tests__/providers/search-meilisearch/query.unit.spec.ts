import { MedusaError } from "@medusajs/framework/utils";
import { toMeiliQuery } from "../../../providers/search-meilisearch/utils/query";

function input(overrides: Record<string, any> = {}): any {
  return {
    index: { name: "products", physical_name: "dev_products_v1", primary_key: "id" },
    attributes_to_retrieve: ["id", "title"],
    ...overrides,
  };
}

describe("toMeiliQuery", () => {
  it("targets the physical index and passes q through", () => {
    const { indexUid, params } = toMeiliQuery(input({ q: "dior" }));
    expect(indexUid).toBe("dev_products_v1");
    expect(params.q).toBe("dior");
  });

  it("uses an empty q for missing, empty and whitespace-only queries", () => {
    expect(toMeiliQuery(input()).params.q).toBe("");
    expect(toMeiliQuery(input({ q: "" })).params.q).toBe("");
    expect(toMeiliQuery(input({ q: "   \t " })).params.q).toBe("");
  });

  it("truncates long queries to 200 characters without throwing", () => {
    expect(toMeiliQuery(input({ q: "a".repeat(600) })).params.q).toBe("a".repeat(200));
  });

  it("maps pagination with defaults and a take cap", () => {
    expect(toMeiliQuery(input({ pagination: { skip: 24, take: 12 } })).params).toMatchObject({ offset: 24, limit: 12 });
    expect(toMeiliQuery(input()).params).toMatchObject({ offset: 0, limit: 20 });
    expect(toMeiliQuery(input({ pagination: { take: 5000 } })).params.limit).toBe(100);
  });

  it("rejects cursor pagination", () => {
    expect(() => toMeiliQuery(input({ pagination: { cursor: "x" } }))).toThrow(MedusaError);
  });

  it("maps order to sort and drops the reserved _score key", () => {
    expect(toMeiliQuery(input({ pagination: { order: { title: "ASC", price: "DESC" } } })).params.sort).toEqual([
      "title:asc",
      "price:desc",
    ]);
    expect(toMeiliQuery(input({ pagination: { order: { _score: "DESC" } } })).params.sort).toBeUndefined();
    expect(() => toMeiliQuery(input({ pagination: { order: { "a:b": "ASC" } } }))).toThrow(MedusaError);
  });

  it("maps match_strategy: all->all, last->last, any->last, default all", () => {
    const strategy = (m?: string) =>
      toMeiliQuery(input({ search_options: m ? { match_strategy: m } : {} })).params.matchingStrategy;
    expect(strategy("all")).toBe("all");
    expect(strategy("last")).toBe("last");
    expect(strategy("any")).toBe("last");
    expect(strategy()).toBe("all");
  });

  it("maps attributes_to_retrieve", () => {
    expect(toMeiliQuery(input()).params.attributesToRetrieve).toEqual(["id", "title"]);
  });

  it("adds the primary key to attributesToRetrieve when missing", () => {
    expect(toMeiliQuery(input({ attributes_to_retrieve: ["title"] })).params.attributesToRetrieve).toEqual([
      "title",
      "id",
    ]);
  });

  it("translates filters", () => {
    expect(toMeiliQuery(input({ filters: { brand: "Dior" } })).params.filter).toBe('brand = "Dior"');
    expect(toMeiliQuery(input()).params.filter).toBeUndefined();
  });

  it("maps value and stats facets to facets and dedupes", () => {
    const { params } = toMeiliQuery(
      input({
        search_options: {
          facets: ["brand", { field: "gender", type: "value" }, { field: "price", type: "stats" }, "brand"],
        },
      }),
    );
    expect(params.facets).toEqual(["brand", "gender", "price"]);
  });

  it("omits facets when none are requested", () => {
    expect(toMeiliQuery(input()).params.facets).toBeUndefined();
  });

  it("rejects range facets", () => {
    expect(() =>
      toMeiliQuery(input({ search_options: { facets: [{ field: "price", type: "range", ranges: [{ from: 0 }] }] } })),
    ).toThrow(MedusaError);
  });

  it("maps highlight with default tags when q is present", () => {
    const { params } = toMeiliQuery(input({ q: "dior", search_options: { highlight: { fields: ["title"] } } }));
    expect(params.attributesToHighlight).toEqual(["title"]);
    expect(params.highlightPreTag).toBe("<mark>");
    expect(params.highlightPostTag).toBe("</mark>");
  });

  it("keeps supplied highlight tags and highlights everything for true", () => {
    const custom = toMeiliQuery(
      input({ q: "x", search_options: { highlight: { fields: ["title"], pre_tag: "<b>", post_tag: "</b>" } } }),
    ).params;
    expect(custom.highlightPreTag).toBe("<b>");
    expect(custom.highlightPostTag).toBe("</b>");
    expect(toMeiliQuery(input({ q: "x", search_options: { highlight: true } })).params.attributesToHighlight).toEqual([
      "*",
    ]);
  });

  it("ignores highlight without a free-text query", () => {
    const { params } = toMeiliQuery(input({ q: "  ", search_options: { highlight: true } }));
    expect(params.attributesToHighlight).toBeUndefined();
    expect(params.highlightPreTag).toBeUndefined();
  });

  it("crops snippets", () => {
    const { params } = toMeiliQuery(
      input({ q: "x", search_options: { highlight: { fields: ["title"], snippet: { length: 10 } } } }),
    );
    expect(params.attributesToCrop).toEqual(["title"]);
    expect(params.cropLength).toBe(10);
  });

  it("maps include_score, min_score, distinct, attributes_to_search_on and locales", () => {
    const { params } = toMeiliQuery(
      input({
        search_options: {
          include_score: true,
          min_score: 0.3,
          distinct: "sku",
          attributes_to_search_on: ["title"],
          locales: ["en"],
        },
      }),
    );
    expect(params).toMatchObject({
      showRankingScore: true,
      rankingScoreThreshold: 0.3,
      distinct: "sku",
      attributesToSearchOn: ["title"],
      locales: ["en"],
    });
  });

  it("does not set typo params (per-index only) and rejects vector search", () => {
    expect(toMeiliQuery(input({ search_options: { typo_tolerance: false } })).params).not.toHaveProperty(
      "typoTolerance",
    );
    expect(() => toMeiliQuery(input({ search_options: { vector: { value: [1] } } }))).toThrow(MedusaError);
  });
});
