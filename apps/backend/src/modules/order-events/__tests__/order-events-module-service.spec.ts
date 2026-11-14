import path from "path"
import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import OrderEventsModuleService from "../service"

moduleIntegrationTestRunner<OrderEventsModuleService>({
  moduleName: "orderEvents",
  resolve: path.resolve(__dirname, ".."),
  testSuite: ({ service, MikroOrmWrapper }) => {
    const backdate = async (id: string, iso: string) => {
      await MikroOrmWrapper.forkManager().execute(
        `update "order_event" set created_at = ? where id = ?`,
        [iso, id]
      )
    }

    describe("OrderEventsModuleService", () => {
      it("recordOrderEvent stores type/actor/old/new for an order", async () => {
        await service.recordOrderEvent({
          order_id: "order_1",
          type: "order.held",
          actor: "user_1",
          old_value: { held: false },
          new_value: { held: true },
        })
        const events = await service.listOrderEvents("order_1")
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({
          order_id: "order_1",
          type: "order.held",
          actor: "user_1",
          old_value: { held: false },
          new_value: { held: true },
        })
        expect(events[0].id).toMatch(/^oevt_/)
      })

      it("listOrderEvents returns newest first and caps at the limit", async () => {
        for (const [i, type] of (
          ["order.held", "order.released", "order.shipped"] as const
        ).entries()) {
          await service.recordOrderEvent({
            order_id: "order_2",
            type,
            actor: "system",
          })
        }
        const all = await (service as any).baseList({ order_id: "order_2" }, {})
        const ids = all.map((e: any) => e.id)
        await backdate(ids[0], "2026-01-01T00:00:00Z")
        await backdate(ids[1], "2026-01-03T00:00:00Z")
        await backdate(ids[2], "2026-01-02T00:00:00Z")

        const events = await service.listOrderEvents("order_2")
        expect(events.map((e) => e.id)).toEqual([ids[1], ids[2], ids[0]])
        const capped = await service.listOrderEvents("order_2", 2)
        expect(capped.map((e) => e.id)).toEqual([ids[1], ids[2]])
      })

      it("events of other orders are not returned", async () => {
        await service.recordOrderEvent({
          order_id: "order_a",
          type: "order.held",
          actor: "system",
        })
        await service.recordOrderEvent({
          order_id: "order_b",
          type: "order.canceled",
          actor: "system",
        })
        const events = await service.listOrderEvents("order_a")
        expect(events).toHaveLength(1)
        expect(events[0].order_id).toBe("order_a")
      })

      it("pruneOlderThan deletes only older rows and returns the count", async () => {
        for (const type of ["order.held", "order.released", "order.shipped"] as const) {
          await service.recordOrderEvent({ order_id: "order_p", type, actor: "system" })
        }
        const all = await (service as any).baseList({ order_id: "order_p" }, {})
        const ids = all.map((e: any) => e.id)
        await backdate(ids[0], "2020-01-01T00:00:00Z")
        await backdate(ids[1], "2021-01-01T00:00:00Z")

        const count = await service.pruneOlderThan(new Date("2024-01-01T00:00:00Z"))
        expect(count).toBe(2)
        const remaining = await service.listOrderEvents("order_p")
        expect(remaining.map((e) => e.id)).toEqual([ids[2]])

        // truly gone, not soft-deleted
        const rows = await MikroOrmWrapper.forkManager().execute(
          `select id from "order_event" where order_id = ?`,
          ["order_p"]
        )
        expect(rows).toHaveLength(1)
        expect(await service.pruneOlderThan(new Date("2024-01-01T00:00:00Z"))).toBe(0)
      })
    })
  },
})
