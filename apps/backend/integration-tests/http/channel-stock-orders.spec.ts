import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { adminHeaders, createAdminUser } from "../fixtures/create-admin-user"
import { createOrderSeeder } from "../fixtures/order"
import { CHANNEL_OFFERS_MODULE } from "../../src/modules/channel-offers"
import { applyOrderToChannelStockWorkflow } from "../../src/workflows/apply-order-to-channel-stock"
import { readOrderStockLines } from "../../src/workflows/steps/apply-order-to-channel-stock"

jest.setTimeout(300000)

medusaIntegrationTestRunner({
  testSuite: ({ dbConnection, getContainer, api }) => {
    beforeEach(async () => {
      await createAdminUser(dbConnection, adminHeaders, getContainer())
    })

    describe("order shape the channel stock workflow depends on", () => {
      // Where each value is read: query.graph on `order` with the fields
      // sales_channel_id, items.id, items.variant_id, items.quantity (this is
      // exactly what readOrderStockLines does inside the workflow step).
      const graphOrder = async (orderId: string) => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data } = await query.graph({
          entity: "order",
          fields: ["id", "sales_channel_id", "items.id", "items.variant_id", "items.quantity"],
          filters: { id: orderId },
        })
        return data[0] as any
      }

      it("an order placed through the store cart flow carries sales_channel_id and item variant_id", async () => {
        const seeder = await createOrderSeeder({ api, container: getContainer() })
        const order = await graphOrder(seeder.order.id)
        expect(order.sales_channel_id).toBe(seeder.salesChannel.id)
        expect(order.items).toHaveLength(1)
        expect(order.items[0].variant_id).toBe(seeder.product.variants[0].id)
        expect(order.items[0].quantity).toBe(1)

        const lines = await readOrderStockLines(getContainer(), seeder.order.id)
        expect(lines).toEqual({
          sales_channel_id: seeder.salesChannel.id,
          items: [
            {
              id: order.items[0].id,
              variant_id: seeder.product.variants[0].id,
              quantity: 1,
            },
          ],
        })
      })

      it("an order imported through the draft-order path (seller-hub import-order) carries them too", async () => {
        const seeder = await createOrderSeeder({ api, container: getContainer() })
        // seller-hub's createDraftOrder posts { sales_channel_id, items:[{variant_id, quantity}] }
        // to the draft order, then converts it (apps/seller-hub/src/sync/import-order.ts).
        const draft = (
          await api.post(
            "/admin/draft-orders",
            {
              email: "import@example.com",
              region_id: seeder.region.id,
              currency_code: "usd",
              sales_channel_id: seeder.salesChannel.id,
              shipping_address: {
                first_name: "Imp",
                last_name: "Orter",
                address_1: "1 Main",
                city: "ny",
                country_code: "us",
                postal_code: "94016",
              },
            },
            adminHeaders
          )
        ).data.draft_order
        await api.post(`/admin/draft-orders/${draft.id}/edit`, {}, adminHeaders)
        await api.post(
          `/admin/draft-orders/${draft.id}/edit/items`,
          { items: [{ variant_id: seeder.product.variants[0].id, quantity: 3 }] },
          adminHeaders
        )
        await api.post(`/admin/draft-orders/${draft.id}/edit/confirm`, {}, adminHeaders)
        await api.post(`/admin/draft-orders/${draft.id}/convert-to-order`, {}, adminHeaders)

        const order = await graphOrder(draft.id)
        expect(order.sales_channel_id).toBe(seeder.salesChannel.id)
        expect(order.items).toHaveLength(1)
        expect(order.items[0].variant_id).toBe(seeder.product.variants[0].id)
        expect(order.items[0].quantity).toBe(3)
      })
    })
    describe("applyOrderToChannelStockWorkflow", () => {
      const poll = async (fn: () => Promise<boolean>, timeoutMs = 10000) => {
        const start = Date.now()
        while (!(await fn())) {
          if (Date.now() - start > timeoutMs) return false
          await new Promise((r) => setTimeout(r, 200))
        }
        return true
      }

      const setup = async () => {
        const seeder = await createOrderSeeder({ api, container: getContainer() })
        const variantId = seeder.product.variants[0].id as string
        const other = (
          await api.post("/admin/sales-channels", { name: "second channel" }, adminHeaders)
        ).data.sales_channel.id as string
        const offers = getContainer().resolve(CHANNEL_OFFERS_MODULE) as any
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY) as any
        const { data: channels } = await query.graph({
          entity: "sales_channel",
          fields: ["id", "created_at"],
        })
        const channelIds = (channels as any[])
          .slice()
          .sort(
            (a, b) =>
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime() ||
              (a.id < b.id ? -1 : 1)
          )
          .map((c) => c.id) as string[]

        // The ensure subscribers create a row per channel asynchronously: wait
        // for them instead of racing them.
        expect(
          await poll(async () => (await offers.listForVariant(variantId)).length === channelIds.length)
        ).toBe(true)
        // The order.placed subscriber also ran during seeding; let it finish and
        // clear what it recorded so the workflow runs below are the first
        // application of this order (stock was 0 then, so it changed nothing).
        await poll(
          async () =>
            (await offers.listChannelStockMovements({ variant_id: variantId, kind: "order" })).length > 0,
          3000
        )
        await dbConnection.raw("delete from channel_stock_movement where variant_id = ?", [variantId])
        await offers.setStocks(variantId, { [seeder.salesChannel.id]: 5, [other]: 3 })

        const stocks = async () =>
          Object.fromEntries(
            (await offers.listForVariant(variantId)).map((r: any) => [r.sales_channel_id, r.stock])
          ) as Record<string, number>
        const run = (mode: "placed" | "canceled") =>
          applyOrderToChannelStockWorkflow(getContainer()).run({
            input: { order_id: seeder.order.id, mode },
          })
        return { seeder, other, stocks, run, offers, variantId, channelIds }
      }

      it("deducts only the order channel, is idempotent, and cancel adds the unit back", async () => {
        const { seeder, other, stocks, run, channelIds } = await setup()
        const expected = (order: number) => ({
          ...Object.fromEntries(channelIds.map((id) => [id, 0])),
          [seeder.salesChannel.id]: order,
          [other]: 3,
        })
        await run("placed")
        expect(await stocks()).toEqual(expected(4))
        const again = await run("placed")
        expect(again.result.changed).toEqual([])
        expect(await stocks()).toEqual(expected(4))
        await run("canceled")
        expect(await stocks()).toEqual(expected(5))
      })

      it("re-splits the pool when the shared stock switch is on", async () => {
        const { seeder, other, stocks, run, offers, variantId, channelIds } = await setup()
        await offers.setStocks(variantId, { [seeder.salesChannel.id]: 8, [other]: 0 })
        await api.post("/admin/channel-stock-settings", { share_stock_after_sale: true }, adminHeaders)
        await run("placed")
        // 8 + 0 - 1 = 7 split equally over ALL channels in creation order:
        // the odd unit goes to the earliest channels (3, 2, 2 for three).
        expect(channelIds).toHaveLength(3)
        expect(await stocks()).toEqual({
          [channelIds[0]]: 3,
          [channelIds[1]]: 2,
          [channelIds[2]]: 2,
        })
      })
    })
  },
})
