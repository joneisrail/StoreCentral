import path from "path"
import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import AccountingModuleService from "../service"

const base = (over: Record<string, unknown> = {}) => ({
  invoice_id: "inv_1",
  supplier_id: "sup_1",
  amount: 10,
  paid_at: new Date("2026-11-10"),
  method: "bank_transfer",
  ...over,
})

moduleIntegrationTestRunner<AccountingModuleService>({
  moduleName: "accounting",
  resolve: path.resolve(__dirname, ".."),
  testSuite: ({ service }) => {
    describe("Payment model", () => {
      it("creates a payment with defaults", async () => {
        const payment = await service.createPayments(base() as any)
        expect(payment.status).toBe("recorded")
        expect(payment.currency_code).toBe("usd")
        expect(typeof payment.display_id).toBe("number")
      })

      it("rejects an unknown method", async () => {
        await expect(
          service.createPayments(base({ method: "bitcoin" }) as any)
        ).rejects.toThrow(/method/i)
        await expect(
          service.createPayments(base({ method: "cheque" }) as any)
        ).resolves.toMatchObject({ method: "cheque" })
      })

      it("persists a void status with voided_at", async () => {
        const payment = await service.createPayments(base() as any)
        const voidedAt = new Date("2026-11-11")
        await service.updatePayments({
          id: payment.id,
          status: "void",
          voided_at: voidedAt,
        } as any)
        const found = await service.retrievePayment(payment.id)
        expect(found.status).toBe("void")
        expect(found.voided_at).toEqual(voidedAt)
      })
    })
  },
})
