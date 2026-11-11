import path from "path"
import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import AccountingModuleService from "../service"

const base = (over: Record<string, unknown> = {}) => ({
  expense_date: new Date("2026-11-10"),
  category: "rent",
  amount: 1200,
  description: "November rent",
  ...over,
})

moduleIntegrationTestRunner<AccountingModuleService>({
  moduleName: "accounting",
  resolve: path.resolve(__dirname, ".."),
  testSuite: ({ service }) => {
    describe("Expense model", () => {
      it("creates an expense with defaults", async () => {
        const expense = await service.createExpenses(base() as any)
        expect(expense.currency_code).toBe("usd")
        expect(expense.payee).toBeNull()
        expect(typeof expense.display_id).toBe("number")
      })

      it("auto-increments display_id", async () => {
        const a = await service.createExpenses(base() as any)
        const b = await service.createExpenses(base() as any)
        expect(b.display_id).toBe(a.display_id + 1)
      })

      it("rejects an unknown category", async () => {
        await expect(
          service.createExpenses(base({ category: "yachts" }) as any)
        ).rejects.toThrow(/category/i)
      })

      it("hides a soft deleted expense and restores it", async () => {
        const expense = await service.createExpenses(base() as any)
        await service.softDeleteExpenses([expense.id])
        expect(await service.listExpenses({ id: expense.id })).toHaveLength(0)
        await service.restoreExpenses([expense.id])
        expect(await service.listExpenses({ id: expense.id })).toHaveLength(1)
      })
    })
  },
})
