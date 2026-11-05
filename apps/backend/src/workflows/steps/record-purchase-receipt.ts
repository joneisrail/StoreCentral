import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { PURCHASE_MODULE } from "../../modules/purchase"
import PurchaseModuleService from "../../modules/purchase/service"
import {
  getStatusAfterReceipt,
  validateReceiveQuantities,
} from "../../modules/purchase/utils"
import { assertPurchaseReceivable } from "./validate-purchase-receipt"

export type RecordPurchaseReceiptStepInput = {
  purchase_id: string
  stock_location_id: string
  items: { purchase_item_id: string; quantity: number }[]
  note?: string
}

export type RecordedPurchaseReceipt = {
  id: string
  stock_location_id: string
  received_at: Date
  note: string | null
  items: { purchase_item_id: string; quantity: number }[]
}

type RecordPurchaseReceiptCompensation = {
  purchase_id: string
  receipt_id: string
  received: { purchase_item_id: string; quantity: number }[]
  previous_status: string
  previous_quantities: { id: string; quantity_received: number }[]
}

const purchaseLockKey = (purchaseId: string) => "purchase:" + purchaseId

const deleteReceipt = async (
  purchaseModule: PurchaseModuleService,
  receiptId: string
) => {
  const lines = await purchaseModule.listPurchaseReceiptItems(
    { receipt_id: receiptId },
    { select: ["id"] }
  )
  if (lines.length) {
    await purchaseModule.deletePurchaseReceiptItems(lines.map((l) => l.id))
  }
  await purchaseModule.deletePurchaseReceipts(receiptId)
}

export const recordPurchaseReceiptStep = createStep(
  "record-purchase-receipt",
  async (input: RecordPurchaseReceiptStepInput, { container }) => {
    const purchaseModule =
      container.resolve<PurchaseModuleService>(PURCHASE_MODULE)
    const locking = container.resolve(Modules.LOCKING)

    // The lock serialises receipts of one purchase, so the quantities read
    // here cannot change before this step has written its own.
    const { output, compensation } = await locking.execute(
      [purchaseLockKey(input.purchase_id)],
      async () => {
        const purchase = await purchaseModule.retrievePurchase(
          input.purchase_id,
          { relations: ["items"] }
        )
        // Authoritative checks: a concurrent receipt may have landed since
        // the validate step read the purchase.
        assertPurchaseReceivable(purchase.status)
        validateReceiveQuantities(purchase.items, input.items)

        const previousQuantities = purchase.items.map((item) => ({
          id: item.id,
          quantity_received: item.quantity_received,
        }))
        const received = input.items.map((line) => ({
          purchase_item_id: line.purchase_item_id,
          quantity: line.quantity,
        }))

        let receiptId: string | undefined
        try {
          const receipt = await purchaseModule.createPurchaseReceipts({
            purchase_id: purchase.id,
            stock_location_id: input.stock_location_id,
            received_at: new Date(),
            note: input.note ?? null,
            // Nested create keeps the receipt and its lines in one write.
            items: received as never,
          } as never)
          receiptId = receipt.id

          const updatedItems = purchase.items.map((item) => ({
            id: item.id,
            quantity: item.quantity,
            quantity_received:
              item.quantity_received +
              (received.find((l) => l.purchase_item_id === item.id)
                ?.quantity ?? 0),
          }))
          await purchaseModule.updatePurchaseItems(
            updatedItems
              .filter((item) =>
                received.some((l) => l.purchase_item_id === item.id)
              )
              .map((item) => ({
                id: item.id,
                quantity_received: item.quantity_received,
              }))
          )

          const status = getStatusAfterReceipt(updatedItems)
          await purchaseModule.updatePurchases({
            id: purchase.id,
            status,
          } as never)

          const recorded: RecordedPurchaseReceipt = {
            id: receipt.id,
            stock_location_id: input.stock_location_id,
            received_at: receipt.received_at as Date,
            note: input.note ?? null,
            items: received,
          }
          const compensation: RecordPurchaseReceiptCompensation = {
            purchase_id: purchase.id,
            receipt_id: receipt.id,
            received,
            previous_status: purchase.status,
            previous_quantities: previousQuantities,
          }

          return {
            output: {
              purchase: { id: purchase.id, status },
              receipt: recorded,
            },
            compensation,
          }
        } catch (error) {
          // A failed step gets no compensation data, so undo the partial
          // write here. The lock is still held, so the snapshot is current.
          try {
            if (receiptId) {
              await deleteReceipt(purchaseModule, receiptId)
            }
            await purchaseModule.updatePurchaseItems(previousQuantities)
            await purchaseModule.updatePurchases({
              id: purchase.id,
              status: purchase.status,
            } as never)
          } catch (undoError) {
            container
              .resolve(ContainerRegistrationKeys.LOGGER)
              .error(
                `Could not undo a partial receipt for purchase ${purchase.id}: ${
                  (undoError as Error).message
                }`
              )
          }
          throw error
        }
      }
    )

    return new StepResponse(output, compensation)
  },
  async (compensation, { container }) => {
    if (!compensation) {
      return
    }

    const purchaseModule =
      container.resolve<PurchaseModuleService>(PURCHASE_MODULE)
    const locking = container.resolve(Modules.LOCKING)

    await locking.execute(
      [purchaseLockKey(compensation.purchase_id)],
      async () => {
        const [existing] = await purchaseModule.listPurchaseReceipts(
          { id: compensation.receipt_id },
          { select: ["id"] }
        )
        if (!existing) {
          // Already compensated.
          return
        }

        // Another receipt may have been recorded after this one released
        // the lock, so subtract this receipt's quantities instead of writing
        // the old values back over the newer ones.
        const items = await purchaseModule.listPurchaseItems(
          { purchase_id: compensation.purchase_id },
          { select: ["id", "quantity", "quantity_received"] }
        )
        const restored = items.map((item) => ({
          id: item.id,
          quantity: item.quantity,
          quantity_received:
            item.quantity_received -
            (compensation.received.find((l) => l.purchase_item_id === item.id)
              ?.quantity ?? 0),
        }))
        await purchaseModule.updatePurchaseItems(
          restored
            .filter((item) =>
              compensation.received.some((l) => l.purchase_item_id === item.id)
            )
            .map((item) => ({
              id: item.id,
              quantity_received: item.quantity_received,
            }))
        )

        // Back to exactly the previous quantities: restore the previous
        // status. Otherwise a later receipt is still counted and the status
        // follows the quantities that remain.
        const unchangedSinceSnapshot = restored.every(
          (item) =>
            compensation.previous_quantities.find((p) => p.id === item.id)
              ?.quantity_received === item.quantity_received
        )
        await purchaseModule.updatePurchases({
          id: compensation.purchase_id,
          status: unchangedSinceSnapshot
            ? compensation.previous_status
            : getStatusAfterReceipt(restored),
        } as never)

        await deleteReceipt(purchaseModule, compensation.receipt_id)
      }
    )
  }
)
