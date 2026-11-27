import { resolveProductIds } from "../resolve-product-ids";

type GraphCall = {
  entity: string;
  fields: string[];
  filters: Record<string, unknown>;
  withDeleted?: boolean;
};

function contextWith(rows: Record<string, Record<string, any>[]>) {
  const calls: GraphCall[] = [];
  const query = {
    graph: async (call: GraphCall) => {
      calls.push(call);
      return { data: rows[call.entity] ?? [] };
    },
  };

  return { calls, context: { container: { query } } as any };
}

describe("resolveProductIds for stock events", () => {
  it("maps an inventory level to the products of its item's variants", async () => {
    const { calls, context } = contextWith({
      inventory_level: [{ inventory_item_id: "iitem_1" }],
      inventory_item: [
        {
          variants: [
            { product_id: "prod_1" },
            { product_id: "prod_2" },
            null,
          ],
        },
      ],
    });

    const ids = await resolveProductIds(
      { name: "inventory-level.updated", data: [{ id: "ilev_1" }] },
      context,
    );

    expect(ids).toEqual(["prod_1", "prod_2"]);
    expect(calls[0]).toEqual(
      expect.objectContaining({
        entity: "inventory_level",
        filters: { id: ["ilev_1"] },
        withDeleted: false,
      }),
    );
    expect(calls[1]).toEqual(
      expect.objectContaining({
        entity: "inventory_item",
        filters: { id: ["iitem_1"] },
      }),
    );
  });

  it("reads a deleted reservation with soft-deleted rows included", async () => {
    const { calls, context } = contextWith({
      reservation: [{ inventory_item_id: "iitem_1" }],
      inventory_item: [{ variants: [{ product_id: "prod_1" }] }],
    });

    const ids = await resolveProductIds(
      { name: "reservation-item.deleted", data: { id: "resitem_1" } },
      context,
    );

    expect(ids).toEqual(["prod_1"]);
    expect(calls[0]).toEqual(
      expect.objectContaining({ entity: "reservation", withDeleted: true }),
    );
  });

  it("stops when the inventory rows lead to no item", async () => {
    const { calls, context } = contextWith({ inventory_level: [] });

    const ids = await resolveProductIds(
      { name: "inventory-level.created", data: { id: "ilev_1" } },
      context,
    );

    expect(ids).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});
