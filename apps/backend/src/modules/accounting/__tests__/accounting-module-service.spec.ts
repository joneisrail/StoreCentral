import path from "path"
import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import AccountingModuleService from "../service"

const base = (over: Record<string, unknown> = {}) => ({
  supplier_id: "sup_1",
  purchase_id: "po_1",
  invoice_number: "A-1",
  invoice_number_key: "a-1",
  invoice_date: new Date("2026-11-01"),
  ...over,
})

moduleIntegrationTestRunner<AccountingModuleService>({
  moduleName: "accounting",
  resolve: path.resolve(__dirname, ".."),
  testSuite: ({ service }) => {
    describe("AccountingModuleService", () => {
      it("creates an invoice with defaults", async () => {
        const invoice = await service.createInvoices(base())
        expect(invoice.status).toBe("draft")
        expect(invoice.currency_code).toBe("usd")
        expect(Number(invoice.shipping_cost)).toBe(0)
        expect(Number(invoice.tax)).toBe(0)
        expect(Number(invoice.other_cost)).toBe(0)
        expect(typeof invoice.display_id).toBe("number")
      })

      it("rejects a duplicate key for the same supplier", async () => {
        await service.createInvoices(base())
        await expect(service.createInvoices(base())).rejects.toThrow()
      })

      it("allows the same key for a different supplier", async () => {
        await service.createInvoices(base())
        await expect(
          service.createInvoices(base({ supplier_id: "sup_2" }))
        ).resolves.toBeDefined()
      })

      it("frees the key when an invoice is voided", async () => {
        const invoice = await service.createInvoices(base())
        await service.updateInvoices({ id: invoice.id, status: "void" })
        await expect(service.createInvoices(base())).resolves.toBeDefined()
      })

      it("keeps blocking the key when an invoice is posted", async () => {
        const invoice = await service.createInvoices(base())
        await service.updateInvoices({ id: invoice.id, status: "posted" })
        await expect(service.createInvoices(base())).rejects.toThrow()
      })
    })
  },
})
