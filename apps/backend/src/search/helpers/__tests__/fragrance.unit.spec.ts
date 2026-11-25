import { toBrands, toMetadataValues, toStock } from "../fragrance";

describe("toBrands", () => {
  it("keeps only categories whose parent is brands", () => {
    expect(
      toBrands([
        { name: "Dior", parent_category: { handle: "brands" } },
        { name: "Men", parent_category: { handle: "gender" } },
        { name: "Orphan", parent_category: null },
        null,
        { name: " Chanel ", parent_category: { handle: "brands" } },
        { name: "  ", parent_category: { handle: "brands" } },
      ]),
    ).toEqual(["Dior", "Chanel"]);
  });

  it("de-duplicates case-insensitively keeping the first spelling", () => {
    expect(
      toBrands([
        { name: "Dior", parent_category: { handle: "brands" } },
        { name: "dior", parent_category: { handle: "brands" } },
      ]),
    ).toEqual(["Dior"]);
  });

  it("handles null and undefined", () => {
    expect(toBrands(null)).toEqual([]);
    expect(toBrands(undefined)).toEqual([]);
  });
});

describe("toMetadataValues", () => {
  it("splits comma-separated strings and de-duplicates", () => {
    expect(toMetadataValues({ notes: "rose, oud, rose" }, "notes")).toEqual([
      "rose",
      "oud",
    ]);
  });

  it("accepts arrays, ignoring non-strings and blanks", () => {
    expect(
      toMetadataValues({ notes: ["Rose", 5, " Oud ", ""] }, "notes"),
    ).toEqual(["Rose", "Oud"]);
  });

  it("collapses inner whitespace and de-duplicates case-insensitively", () => {
    expect(
      toMetadataValues({ notes: ["Dark   Rose", "dark rose"] }, "notes"),
    ).toEqual(["Dark Rose"]);
  });

  it("returns [] for empty, null, number and missing key", () => {
    expect(toMetadataValues({ notes: "" }, "notes")).toEqual([]);
    expect(toMetadataValues({ notes: null }, "notes")).toEqual([]);
    expect(toMetadataValues({ notes: 5 }, "notes")).toEqual([]);
    expect(toMetadataValues({}, "notes")).toEqual([]);
    expect(toMetadataValues(null, "notes")).toEqual([]);
    expect(toMetadataValues(undefined, "notes")).toEqual([]);
  });

  it("truncates to 30 values", () => {
    const many = Array.from({ length: 40 }, (_, i) => `note${i}`);
    const result = toMetadataValues({ notes: many }, "notes");
    expect(result).toHaveLength(30);
    expect(result[29]).toBe("note29");
  });
});

describe("toStock", () => {
  it("is out of stock with no variants", () => {
    expect(toStock([])).toEqual({ in_stock: false, single_variant_id: null });
    expect(toStock(null)).toEqual({ in_stock: false, single_variant_id: null });
  });

  it("treats untracked inventory as in stock", () => {
    expect(toStock([{ id: "v1", manage_inventory: false }])).toEqual({
      in_stock: true,
      single_variant_id: "v1",
    });
  });

  it("is out of stock when tracked with 0 and no backorder", () => {
    expect(
      toStock([
        {
          id: "v1",
          manage_inventory: true,
          allow_backorder: false,
          inventory_quantity: 0,
        },
      ]),
    ).toEqual({ in_stock: false, single_variant_id: "v1" });
  });

  it("is in stock when backorders are allowed", () => {
    expect(
      toStock([
        {
          id: "v1",
          manage_inventory: true,
          allow_backorder: true,
          inventory_quantity: 0,
        },
      ]).in_stock,
    ).toBe(true);
  });

  it("is in stock when tracked with quantity 3", () => {
    expect(
      toStock([
        { id: "v1", manage_inventory: true, inventory_quantity: 3 },
      ]).in_stock,
    ).toBe(true);
  });

  it("has no single variant id with two variants", () => {
    expect(
      toStock([
        { id: "v1", manage_inventory: true, inventory_quantity: 1 },
        { id: "v2", manage_inventory: true, inventory_quantity: 0 },
      ]),
    ).toEqual({ in_stock: true, single_variant_id: null });
  });

  it("has no single variant id when the variant lacks an id", () => {
    expect(toStock([{ manage_inventory: false }])).toEqual({
      in_stock: true,
      single_variant_id: null,
    });
  });
});
