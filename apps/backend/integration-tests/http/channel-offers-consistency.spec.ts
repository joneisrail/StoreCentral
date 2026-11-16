import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { adminHeaders, createAdminUser } from "../fixtures/create-admin-user"
import { CHANNEL_OFFERS_MODULE } from "../../src/modules/channel-offers"
import { trimChannelStockWorkflow } from "../../src/workflows/trim-channel-stock"
import channelStockTrim from "../../src/subscribers/channel-stock-trim"

jest.setTimeout(300000)

// Polls until `fn` returns a truthy value (subscribers run asynchronously).
async function waitFor<T>(fn: () => Promise<T>, timeoutMs = 20000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out")
    await new Promise((r) => setTimeout(r, 200))
  }
}

medusaIntegrationTestRunner({
  testSuite: ({ dbConnection, getContainer, api }) => {
    let counter = 0
    beforeEach(async () => {
      await createAdminUser(dbConnection, adminHeaders, getContainer())
    })

    const offers = () => getContainer().resolve(CHANNEL_OFFERS_MODULE) as any
    const query = () => getContainer().resolve(ContainerRegistrationKeys.QUERY) as any

    const createChannel = async (name: string) =>
      (await api.post("/admin/sales-channels", { name }, adminHeaders)).data.sales_channel
        .id as string

    const createVariant = async (manage: boolean) => {
      counter += 1
      const product = (
        await api.post(
          "/admin/products",
          {
            title: `Consistency product ${counter}`,
            options: [{ title: "size", values: ["l"] }],
            variants: [
              {
                title: "v",
                sku: `CONS-${counter}`,
                manage_inventory: manage,
                prices: [{ currency_code: "usd", amount: 100 }],
                options: { size: "l" },
              },
            ],
          },
          adminHeaders
        )
      ).data.product
      return product.variants[0].id as string
    }

    const allChannelIds = async () =>
      (
        await query().graph({ entity: "sales_channel", fields: ["id", "created_at"] })
      ).data
        .slice()
        .sort(
          (a: any, b: any) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime() ||
            (a.id < b.id ? -1 : 1)
        )
        .map((c: any) => c.id) as string[]

    const stocks = async (variantId: string) =>
      Object.fromEntries(
        (await offers().listForVariant(variantId)).map((r: any) => [r.sales_channel_id, r.stock])
      ) as Record<string, number>

    describe("rows exist for every variant and channel", () => {
      it("a new variant gets rows for all channels, ordered by channel creation", async () => {
        const c1 = await createChannel("first extra")
        const c2 = await createChannel("second extra")
        const variantId = await createVariant(false)
        const channels = await allChannelIds()
        await waitFor(async () => (await offers().listForVariant(variantId)).length === channels.length)
        const rows = await offers().listForVariant(variantId)
        expect(rows.map((r: any) => r.sales_channel_id)).toEqual(channels)
        expect(channels.indexOf(c1)).toBeLessThan(channels.indexOf(c2))
        expect(rows.every((r: any) => r.stock === 0 && r.price === null)).toBe(true)
      })

      it("a new channel gets rows for all variants with stock 0 and leaves other channels untouched", async () => {
        const existing = await createChannel("existing")
        const v1 = await createVariant(false)
        const v2 = await createVariant(false)
        await waitFor(async () => (await offers().listForVariant(v2)).length >= 2)
        await offers().setStocks(v1, { [existing]: 7 })

        const fresh = await createChannel("fresh")
        await waitFor(async () => {
          const r1 = await offers().listForVariant(v1)
          const r2 = await offers().listForVariant(v2)
          return [r1, r2].every((r: any[]) => r.some((x) => x.sales_channel_id === fresh))
        })
        for (const v of [v1, v2]) {
          const row = (await offers().listForVariant(v)).find(
            (r: any) => r.sales_channel_id === fresh
          )
          expect(row.stock).toBe(0)
          expect(row.price).toBeNull()
        }
        expect((await stocks(v1))[existing]).toBe(7)
        // every variant in the catalog has a row for the new channel
        const { data: variants } = await query().graph({
          entity: "product_variant",
          fields: ["id"],
        })
        for (const v of variants) {
          const rows = await offers().listForVariant(v.id)
          expect(rows.some((r: any) => r.sales_channel_id === fresh)).toBe(true)
        }
      })
    })

    describe("trim on inventory level change", () => {
      const setup = async () => {
        const a = await createChannel("trim a")
        const b = await createChannel("trim b")
        const c = await createChannel("trim c")
        const location = (
          await api.post("/admin/stock-locations", { name: "trim location" }, adminHeaders)
        ).data.stock_location
        const variantId = await createVariant(true)
        await waitFor(async () => (await offers().listForVariant(variantId)).length >= 3)
        const { data } = await query().graph({
          entity: "product_variant",
          fields: ["id", "inventory_items.inventory_item_id"],
          filters: { id: variantId },
        })
        const itemId = data[0].inventory_items[0].inventory_item_id as string
        await api.post(
          `/admin/inventory-items/${itemId}/location-levels`,
          { location_id: location.id, stocked_quantity: 10 },
          adminHeaders
        )
        await offers().setStocks(variantId, { [a]: 6, [b]: 2, [c]: 2 })
        const setLevel = (qty: number) =>
          api.post(
            `/admin/inventory-items/${itemId}/location-levels/${location.id}`,
            { stocked_quantity: qty },
            adminHeaders
          )
        const trims = async () =>
          (await offers().listChannelStockMovements({ variant_id: variantId, kind: "trim" })) as any[]
        return { a, b, c, variantId, itemId, location, setLevel, trims }
      }

      it("resolves the level's item and variants with the graph names the subscriber uses", async () => {
        const { variantId, itemId, location } = await setup()
        const { data: levels } = await query().graph({
          entity: "inventory_level",
          fields: ["id", "inventory_item_id"],
          filters: { inventory_item_id: itemId, location_id: location.id },
        })
        expect(levels[0].inventory_item_id).toBe(itemId)
        const { data: items } = await query().graph({
          entity: "inventory_item",
          fields: ["id", "variants.id"],
          filters: { id: itemId },
        })
        expect(items[0].variants.map((v: any) => v.id)).toEqual([variantId])
      })

      it("a decrease below the sum trims the largest channel first and records trim movements", async () => {
        const { a, b, c, variantId, setLevel, trims } = await setup()
        await setLevel(6)
        await waitFor(async () => (await trims()).length > 0)
        expect(await stocks(variantId)).toMatchObject({ [a]: 2, [b]: 2, [c]: 2 })
        const moves = await trims()
        expect(moves.map((m) => [m.sales_channel_id, m.delta])).toEqual([[a, -4]])
        expect(moves[0].ref).toMatch(/^trim:/)
      })

      it("an increase or a change within the total leaves stock unchanged", async () => {
        const { a, b, c, variantId, setLevel, trims, itemId, location } = await setup()
        await setLevel(30)
        // Run the subscriber directly so the no-op is awaited deterministically.
        const { data: levels } = await query().graph({
          entity: "inventory_level",
          fields: ["id"],
          filters: { inventory_item_id: itemId, location_id: location.id },
        })
        await channelStockTrim({
          event: { name: "inventory-level.updated", data: { id: levels[0].id } },
          container: getContainer(),
        } as any)
        expect(await stocks(variantId)).toMatchObject({ [a]: 6, [b]: 2, [c]: 2 })
        expect(await trims()).toEqual([])
      })

      it("an unmanaged variant is not trimmed", async () => {
        const variantId = await createVariant(false)
        await waitFor(async () => (await offers().listForVariant(variantId)).length >= 1)
        const rows = await offers().listForVariant(variantId)
        await offers().setStocks(variantId, { [rows[0].sales_channel_id]: 4 })
        const { result } = await trimChannelStockWorkflow(getContainer()).run({
          input: { variant_id: variantId },
        })
        expect(result.changed).toEqual([])
        expect((await stocks(variantId))[rows[0].sales_channel_id]).toBe(4)
      })
    })
  },
})
