import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { adminHeaders, createAdminUser } from "../fixtures/create-admin-user"
import { loadGrid } from "../../src/api/admin/channel-offers/query"
import { CHANNEL_OFFERS_MODULE } from "../../src/modules/channel-offers"
jest.setTimeout(1800000)
process.env.CHANNEL_GRID_STOCK_MEMO_TTL_MS = "0"
medusaIntegrationTestRunner({
  testSuite: ({ dbConnection, getContainer, api }) => {
    it("perf", async () => {
      await createAdminUser(dbConnection, adminHeaders, getContainer())
      const c = getContainer()
      const N = Number(process.env.PERF_N ?? 5000)
      const per = 100
      const productMod = c.resolve(Modules.PRODUCT) as any
      const invMod = c.resolve(Modules.INVENTORY) as any
      const link = c.resolve(ContainerRegistrationKeys.LINK) as any
      const stockLoc = (await (c.resolve(Modules.STOCK_LOCATION) as any).createStockLocations({ name: "W" })).id
      const t0 = Date.now()
      const variantIds: string[] = []
      for (let p = 0; p < N / per; p++) {
        const prod = await productMod.createProducts({
          title: `Perf ${p}`,
          options: [{ title: "n", values: Array.from({ length: per }, (_, i) => `v${i}`) }],
          variants: Array.from({ length: per }, (_, i) => ({ title: `v${i}`, sku: `P${p}-${i}`, manage_inventory: true, options: { n: `v${i}` } })),
        })
        variantIds.push(...prod.variants.map((v: any) => v.id))
      }
      const items = await invMod.createInventoryItems(variantIds.map((id, i) => ({ sku: `I${i}` })))
      await invMod.createInventoryLevels(items.map((it: any, i: number) => ({ inventory_item_id: it.id, location_id: stockLoc, stocked_quantity: i % 50 })))
      for (let i = 0; i < variantIds.length; i += 500) {
        await link.create(variantIds.slice(i, i + 500).map((vid, j) => ({
          [Modules.PRODUCT]: { variant_id: vid },
          [Modules.INVENTORY]: { inventory_item_id: items[i + j].id },
          data: { required_quantity: 1 },
        })))
      }
      console.log("seed ms", Date.now() - t0)
      const q = c.resolve(ContainerRegistrationKeys.QUERY) as any
      const { data: chs } = await q.graph({ entity: "sales_channel", fields: ["id"] })
      const svc = c.resolve(CHANNEL_OFFERS_MODULE) as any
      for (let i = 0; i < variantIds.length; i += 500) await svc.ensureOffers(variantIds.slice(i, i + 500), chs.map((x: any) => x.id))
      let t9 = Date.now()
      const lv = await invMod.listInventoryLevels({}, { select: ["inventory_item_id", "stocked_quantity", "reserved_quantity"], take: null })
      console.log("MOD levels", lv.length, Date.now() - t9); t9 = Date.now()
      const vs = await productMod.listProductVariants({}, { select: ["id", "sku", "title", "product_id", "manage_inventory"], take: null })
      console.log("MOD variants", vs.length, Date.now() - t9); t9 = Date.now()
      const lm = link.getLinkModule(Modules.PRODUCT, "variant_id", Modules.INVENTORY, "inventory_item_id")
      const ls = await lm.list({}, { take: null })
      console.log("MOD links", ls.length, Date.now() - t9, JSON.stringify(ls[0]))
      const pg = c.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any
      t9 = Date.now()
      const raw = await pg.raw("select l.variant_id, l.required_quantity, coalesce(sum(il.stocked_quantity - il.reserved_quantity),0) as net from product_variant_inventory_item l left join inventory_level il on il.inventory_item_id = l.inventory_item_id and il.deleted_at is null where l.deleted_at is null group by l.variant_id, l.required_quantity, l.inventory_item_id")
      console.log("MOD raw", raw.rows.length, Date.now() - t9)
      const timed: Record<string, number> = {}
      const deps: any = {
        query: { graph: async (a: any) => { const t = Date.now(); const r = await q.graph(a); const k = a.entity + (a.pagination?.skip ? "+" : ""); timed[k] = (timed[k] ?? 0) + (Date.now() - t); return r } },
        offers: svc,
        connectedChannelIds: async () => new Set(),
      }
      for (const order of ["total", "name"]) {
        for (const k of Object.keys(timed)) delete timed[k]
        const t = Date.now()
        await loadGrid(deps, { order, limit: 50, offset: 0 })
        console.log("PHASES", order, Date.now() - t, JSON.stringify(timed))
      }
      for (const qs of ["", "", "?order=name", "?order=-unallocated", `?order=${chs[0].id}:stock`, "?q=perf%205"]) {
        const t = Date.now()
        const r = await api.get(`/admin/channel-offers${qs}`, adminHeaders)
        console.log("PERF", qs || "(default)", Date.now() - t, "ms count", r.data.count, "first", r.data.rows[0]?.available)
      }
    })
  },
})
