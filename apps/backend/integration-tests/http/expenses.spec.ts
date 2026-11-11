import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ACCOUNTING_MODULE } from "../../src/modules/accounting"
import { createAdminUser } from "../helpers/create-admin-user"

jest.setTimeout(300000)

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    const adminHeaders = { headers: {} as Record<string, string> }

    beforeEach(async () => {
      await createAdminUser(getContainer(), adminHeaders)
    })

    const accounting = () => getContainer().resolve(ACCOUNTING_MODULE) as any

    const baseBody = (over: Record<string, unknown> = {}) => ({
      expense_date: "2026-03-05",
      category: "rent",
      amount: 12.5,
      description: "March rent",
      ...over,
    })

    const create = (over: Record<string, unknown> = {}) =>
      api
        .post("/admin/expenses", baseBody(over), adminHeaders)
        .catch((e) => e.response)

    const list = (qs = "") =>
      api.get(`/admin/expenses${qs}`, adminHeaders).catch((e) => e.response)

    const countExpenses = async () => {
      const [, count] = await accounting().listAndCountExpenses({})
      return count as number
    }

    const dayOffset = (days: number) =>
      new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)

    describe("POST /admin/expenses", () => {
      it("creates an expense with a reference and a calendar date", async () => {
        const response = await create({ payee: "  Landlord Ltd  " })

        expect(response.status).toBe(200)
        expect(response.data.expense).toEqual(
          expect.objectContaining({
            reference: "EXP-0001",
            expense_date: "2026-03-05",
            category: "rent",
            amount: 12.5,
            description: "March rent",
            payee: "Landlord Ltd",
            currency_code: "usd",
          })
        )
        const second = await create()
        expect(second.data.expense.reference).toBe("EXP-0002")
        expect(second.data.expense.payee).toBeNull()
      })

      it("stores the date as 00:00 UTC of the chosen day", async () => {
        const response = await create()
        const row = await accounting().retrieveExpense(response.data.expense.id)
        expect(new Date(row.expense_date).toISOString()).toBe(
          "2026-03-05T00:00:00.000Z"
        )
      })

      it("refuses invalid amounts and names the rule", async () => {
        for (const amount of [0, -1, 12.499999999, 12.345]) {
          const response = await create({ amount })
          expect(response.status).toBe(400)
          expect(response.data.message).toMatch(
            /greater than zero with at most 2 decimal places/
          )
        }
        expect(await countExpenses()).toBe(0)
      })

      it("accepts 12.5 and 100", async () => {
        expect((await create({ amount: 12.5 })).status).toBe(200)
        const hundred = await create({ amount: 100 })
        expect(hundred.status).toBe(200)
        expect(hundred.data.expense.amount).toBe(100)
      })

      it("refuses an unknown category and lists the allowed values", async () => {
        const response = await create({ category: "snacks" })
        expect(response.status).toBe(400)
        for (const c of ["rent", "marketing", "shipping_packaging", "other"]) {
          expect(response.data.message).toContain(c)
        }
      })

      it("refuses a bad date and a date more than a day in the future", async () => {
        for (const expense_date of ["2026-13-01", "05/03/2026", "nope"]) {
          expect((await create({ expense_date })).status).toBe(400)
        }
        expect((await create({ expense_date: dayOffset(2) })).status).toBe(400)
        expect((await create({ expense_date: dayOffset(1) })).status).toBe(200)
        expect(await countExpenses()).toBe(1)
      })

      it("validates description and payee", async () => {
        expect((await create({ description: "" })).status).toBe(400)
        expect((await create({ description: "   " })).status).toBe(400)
        expect((await create({ description: "a".repeat(201) })).status).toBe(400)
        expect((await create({ description: "a".repeat(200) })).status).toBe(200)
        expect((await create({ payee: "p".repeat(201) })).status).toBe(400)

        const blank = await create({ payee: "   " })
        expect(blank.status).toBe(200)
        expect(blank.data.expense.payee).toBeNull()
      })

      it("rejects an unauthenticated request with 401", async () => {
        const response = await api
          .post("/admin/expenses", baseBody())
          .catch((e) => e.response)
        expect(response.status).toBe(401)
        const get = await api.get("/admin/expenses").catch((e) => e.response)
        expect(get.status).toBe(401)
        expect(await countExpenses()).toBe(0)
      })

      it("does not change orders or stock", async () => {
        const query = getContainer().resolve("query") as any
        const snapshot = async () => ({
          orders: (await query.graph({ entity: "order", fields: ["id"] })).data
            .length,
          levels: (
            await query.graph({
              entity: "inventory_level",
              fields: ["id", "stocked_quantity"],
            })
          ).data,
        })
        const before = await snapshot()
        await create()
        expect(await snapshot()).toEqual(before)
      })
    })

    describe("GET/POST/DELETE /admin/expenses/:id", () => {
      it("retrieves one expense", async () => {
        const { id } = (await create()).data.expense
        const response = await api.get(`/admin/expenses/${id}`, adminHeaders)
        expect(response.data.expense.id).toBe(id)
        expect(response.data.expense.reference).toBe("EXP-0001")
      })

      it("updates fields and re-validates", async () => {
        const { id } = (await create({ payee: "Old" })).data.expense
        const update = (body: Record<string, unknown>) =>
          api
            .post(`/admin/expenses/${id}`, body, adminHeaders)
            .catch((e) => e.response)

        const ok = await update({
          category: "software",
          amount: 99.99,
          description: "  Tool  ",
          expense_date: "2026-03-06",
          payee: null,
        })
        expect(ok.status).toBe(200)
        expect(ok.data.expense).toEqual(
          expect.objectContaining({
            category: "software",
            amount: 99.99,
            description: "Tool",
            expense_date: "2026-03-06",
            payee: null,
          })
        )

        expect((await update({ amount: 12.345 })).status).toBe(400)
        expect((await update({ amount: 0 })).status).toBe(400)
        expect((await update({ category: "snacks" })).status).toBe(400)
        expect((await update({ expense_date: dayOffset(5) })).status).toBe(400)
        expect((await update({ description: " " })).status).toBe(400)
        expect((await update({})).status).toBe(400)

        const still = await api.get(`/admin/expenses/${id}`, adminHeaders)
        expect(still.data.expense.amount).toBe(99.99)
        expect((await update({ amount: 5 })).data.expense.amount).toBe(5)
      })

      it("returns 404 for a missing expense on get and update", async () => {
        const get = await api
          .get("/admin/expenses/exp_missing", adminHeaders)
          .catch((e) => e.response)
        expect(get.status).toBe(404)
        const upd = await api
          .post("/admin/expenses/exp_missing", { amount: 1 }, adminHeaders)
          .catch((e) => e.response)
        expect(upd.status).toBe(404)
      })

      it("deletes, then get and a second delete return 404", async () => {
        const { id } = (await create()).data.expense
        const del = await api.delete(`/admin/expenses/${id}`, adminHeaders)
        expect(del.status).toBe(200)
        expect(del.data).toEqual({ id, object: "expense", deleted: true })

        const get = await api
          .get(`/admin/expenses/${id}`, adminHeaders)
          .catch((e) => e.response)
        expect(get.status).toBe(404)
        const again = await api
          .delete(`/admin/expenses/${id}`, adminHeaders)
          .catch((e) => e.response)
        expect(again.status).toBe(404)
        const upd = await api
          .post(`/admin/expenses/${id}`, { amount: 3 }, adminHeaders)
          .catch((e) => e.response)
        expect(upd.status).toBe(404)
      })
    })

    describe("GET /admin/expenses", () => {
      it("lists newest first with count and total", async () => {
        await create({ expense_date: "2026-03-01", amount: 10, description: "a" })
        await create({ expense_date: "2026-03-09", amount: 20.25, description: "b" })
        await create({ expense_date: "2026-03-09", amount: 5, description: "c" })

        const response = await list()
        expect(response.status).toBe(200)
        expect(response.data.expenses.map((e: any) => e.description)).toEqual([
          "c",
          "b",
          "a",
        ])
        expect(response.data.count).toBe(3)
        expect(response.data.offset).toBe(0)
        expect(response.data.limit).toBe(20)
        expect(response.data.total_amount).toBe(35.25)
      })

      it("returns an empty list with a zero total", async () => {
        const response = await list()
        expect(response.data.expenses).toEqual([])
        expect(response.data.count).toBe(0)
        expect(response.data.total_amount).toBe(0)
      })

      it("filters by category", async () => {
        await create({ category: "rent", amount: 1 })
        await create({ category: "fees", amount: 2 })
        const response = await list("?category=fees")
        expect(response.data.count).toBe(1)
        expect(response.data.expenses[0].category).toBe("fees")
        expect(response.data.total_amount).toBe(2)
        expect((await list("?category=snacks")).status).toBe(400)
      })

      it("filters from/to inclusive on both ends", async () => {
        await create({ expense_date: "2026-03-04", description: "before" })
        await create({ expense_date: "2026-03-05", description: "on from" })
        await create({ expense_date: "2026-03-07", description: "middle" })
        await create({ expense_date: "2026-03-10", description: "on to" })
        await create({ expense_date: "2026-03-11", description: "after" })

        const response = await list("?from=2026-03-05&to=2026-03-10")
        expect(
          response.data.expenses.map((e: any) => e.description).sort()
        ).toEqual(["middle", "on from", "on to"])
        expect(response.data.count).toBe(3)

        const single = await list("?from=2026-03-10&to=2026-03-10")
        expect(single.data.count).toBe(1)
        expect(single.data.expenses[0].description).toBe("on to")

        expect((await list("?from=2026-03-10")).data.count).toBe(2)
        expect((await list("?to=2026-03-04")).data.count).toBe(1)
      })

      it("refuses from after to, and bad dates", async () => {
        expect((await list("?from=2026-03-10&to=2026-03-05")).status).toBe(400)
        expect((await list("?from=nope")).status).toBe(400)
      })

      it("searches description and payee case-insensitively", async () => {
        await create({ description: "Facebook Ads", payee: "Meta" })
        await create({ description: "Rent", payee: "Big LANDLORD" })
        await create({ description: "Other", payee: null })

        expect((await list("?q=facebook")).data.count).toBe(1)
        expect((await list("?q=landlord")).data.count).toBe(1)
        expect((await list("?q=ADS")).data.count).toBe(1)
        expect((await list("?q=zzz")).data.count).toBe(0)
      })

      it("treats % and _ in the search as literal", async () => {
        await create({ description: "100% promo" })
        await create({ description: "100x promo" })
        await create({ description: "a_b" })
        await create({ description: "axb" })

        const percent = await list(`?q=${encodeURIComponent("100%")}`)
        expect(percent.data.count).toBe(1)
        expect(percent.data.expenses[0].description).toBe("100% promo")

        const underscore = await list(`?q=${encodeURIComponent("a_b")}`)
        expect(underscore.data.count).toBe(1)
        expect(underscore.data.expenses[0].description).toBe("a_b")
      })

      it("paginates and totals every match across pages", async () => {
        for (let i = 1; i <= 5; i++) {
          await create({
            expense_date: `2026-03-0${i}`,
            amount: i * 10,
            description: `e${i}`,
          })
        }
        const page1 = await list("?limit=2&offset=0")
        expect(page1.data.expenses.map((e: any) => e.description)).toEqual([
          "e5",
          "e4",
        ])
        expect(page1.data.count).toBe(5)
        expect(page1.data.limit).toBe(2)
        expect(page1.data.total_amount).toBe(150)

        const page3 = await list("?limit=2&offset=4")
        expect(page3.data.expenses.map((e: any) => e.description)).toEqual([
          "e1",
        ])
        expect(page3.data.total_amount).toBe(150)
        expect(page3.data.offset).toBe(4)

        expect((await list("?limit=101")).status).toBe(400)
        expect((await list("?limit=0")).status).toBe(400)
      })

      it("sums in whole cents without drift", async () => {
        await create({ amount: 0.1 })
        await create({ amount: 0.2 })
        expect((await list()).data.total_amount).toBe(0.3)
      })

      it("excludes deleted expenses from the list and the total", async () => {
        const keep = (await create({ amount: 10 })).data.expense
        const gone = (await create({ amount: 90 })).data.expense
        await api.delete(`/admin/expenses/${gone.id}`, adminHeaders)

        const response = await list()
        expect(response.data.count).toBe(1)
        expect(response.data.expenses[0].id).toBe(keep.id)
        expect(response.data.total_amount).toBe(10)
      })
    })
  },
})
