import type PurchaseModuleService from "../../modules/purchase/service"

export type PurchaseStatusSnapshot = {
  id: string
  status: string
  ordered_at: Date | null
}

export const snapshotPurchaseStatus = (purchase: {
  id: string
  status: string
  ordered_at?: Date | string | null
}): PurchaseStatusSnapshot => ({
  id: purchase.id,
  status: purchase.status,
  ordered_at: purchase.ordered_at ? new Date(purchase.ordered_at) : null,
})

export const restorePurchaseStatus = async (
  purchaseModule: PurchaseModuleService,
  previous: PurchaseStatusSnapshot
) => {
  await purchaseModule.updatePurchases({
    id: previous.id,
    status: previous.status,
    ordered_at: previous.ordered_at,
  } as never)
}
