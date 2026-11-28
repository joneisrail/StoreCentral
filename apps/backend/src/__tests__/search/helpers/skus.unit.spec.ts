import { toSkus } from "../../../search/helpers/fragrance";

describe("toSkus", () => {
  it("trims, drops empty, null and duplicate values, keeping order", () => {
    expect(
      toSkus([
        { sku: " AI0079777 " },
        { sku: "AI0079777" },
        { sku: "" },
        { sku: "   " },
        { sku: null },
        { sku: undefined },
        null,
        { sku: "AI0079778" },
      ]),
    ).toEqual(["AI0079777", "AI0079778"]);
  });

  it("returns an empty list for no variants", () => {
    expect(toSkus(null)).toEqual([]);
    expect(toSkus(undefined)).toEqual([]);
    expect(toSkus([])).toEqual([]);
  });
});
