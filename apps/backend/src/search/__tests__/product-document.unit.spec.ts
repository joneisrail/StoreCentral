import { toDocument } from "../product";

// Registering the index needs a booted Medusa module loader; only the
// document mapping is under test here.
jest.mock("@medusajs/framework/utils", () => ({
  ...jest.requireActual("@medusajs/framework/utils"),
  defineSearchIndex: (definition: unknown) => definition,
}));

const fixture = {
  id: "prod_1",
  title: "Sauvage",
  status: "published",
  categories: [
    { name: "Dior", parent_category: { handle: "brands" } },
    { name: "Men", parent_category: { handle: "gender" } },
  ],
  metadata: {
    gender: "Men",
    fragrance_family: "Fresh, Spicy",
    notes: ["Bergamot", "Pepper", "Ambroxan"],
    concentration: "Eau de Parfum",
  },
  variants: [
    {
      id: "variant_1",
      manage_inventory: true,
      allow_backorder: false,
    },
    {
      id: "variant_2",
      manage_inventory: true,
      allow_backorder: false,
    },
  ],
};

describe("toDocument", () => {
  it("fills brand, fragrance attributes and stock", () => {
    const document = toDocument(fixture, undefined, {
      variant_1: 0,
      variant_2: 4,
    });

    expect(document).toEqual(
      expect.objectContaining({
        id: "prod_1",
        brand: ["Dior"],
        gender: ["Men"],
        fragrance_family: ["Fresh", "Spicy"],
        notes: ["Bergamot", "Pepper", "Ambroxan"],
        concentration: ["Eau de Parfum"],
        in_stock: true,
        single_variant_id: null,
      }),
    );
  });

  it("reports out of stock when no tracked variant has a quantity", () => {
    const document = toDocument(fixture, undefined, {
      variant_1: 0,
      variant_2: null,
    });

    expect(document.in_stock).toBe(false);
  });

  it("uses the read availability over a quantity on the row", () => {
    const document = toDocument(
      {
        id: "prod_2",
        variants: [
          {
            id: "variant_3",
            manage_inventory: true,
            allow_backorder: false,
            inventory_quantity: 5,
          },
        ],
      },
      undefined,
      { variant_3: 0 },
    );

    expect(document.in_stock).toBe(false);
    expect(document.single_variant_id).toBe("variant_3");
  });

  it("returns empty values for a bare product", () => {
    const document = toDocument({ id: "prod_bare" }, undefined);

    expect(document).toEqual(
      expect.objectContaining({
        brand: [],
        gender: [],
        fragrance_family: [],
        notes: [],
        concentration: [],
        in_stock: false,
        single_variant_id: null,
      }),
    );
  });
});
