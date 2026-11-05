import {
  restorePurchaseStatus,
  snapshotPurchaseStatus,
} from "../purchase-status-restore"

describe("purchase status snapshot and restore", () => {
  it("snapshots a null ordered_at as null and restores it", async () => {
    const snapshot = snapshotPurchaseStatus({
      id: "pur_1",
      status: "draft",
      ordered_at: null,
    })
    expect(snapshot).toEqual({ id: "pur_1", status: "draft", ordered_at: null })

    const updatePurchases = jest.fn()
    await restorePurchaseStatus({ updatePurchases } as any, snapshot)
    expect(updatePurchases).toHaveBeenCalledWith({
      id: "pur_1",
      status: "draft",
      ordered_at: null,
    })
  })

  it("round-trips an ordered_at date, normalising strings to Date", async () => {
    const orderedAt = new Date("2026-11-06T10:00:00.000Z")
    const snapshot = snapshotPurchaseStatus({
      id: "pur_2",
      status: "ordered",
      ordered_at: orderedAt.toISOString(),
    })
    expect(snapshot.ordered_at).toEqual(orderedAt)

    const updatePurchases = jest.fn()
    await restorePurchaseStatus({ updatePurchases } as any, snapshot)
    expect(updatePurchases).toHaveBeenCalledWith({
      id: "pur_2",
      status: "ordered",
      ordered_at: orderedAt,
    })
  })
})
