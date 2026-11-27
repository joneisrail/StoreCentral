import { loadAvailability } from "../availability";

describe("loadAvailability", () => {
  it("returns the summed available quantity per variant across locations", async () => {
    const calls: any[] = [];
    const query = {
      graph: async (call: any) => {
        calls.push(call);
        return {
          data: [
            {
              variant_id: "variant_1",
              required_quantity: 1,
              variant: { manage_inventory: true, allow_backorder: false },
              inventory: {
                location_levels: [
                  { location_id: "sloc_1", available_quantity: 3 },
                  { location_id: "sloc_2", available_quantity: 2 },
                ],
              },
            },
          ],
        };
      },
    };

    const availability = await loadAvailability(
      ["variant_1", "variant_2", "variant_1"],
      { container: { query } } as any,
    );

    expect(availability).toEqual({ variant_1: 5, variant_2: null });
    expect(calls[0].filters).toEqual({ variant_id: ["variant_1", "variant_2"] });
  });

  it("skips the read when there are no variants", async () => {
    const query = {
      graph: async () => {
        throw new Error("should not be called");
      },
    };

    await expect(
      loadAvailability([], { container: { query } } as any),
    ).resolves.toEqual({});
  });
});
