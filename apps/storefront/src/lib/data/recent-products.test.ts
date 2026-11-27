import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./products", () => ({ listProducts: vi.fn() }))

import { listProducts } from "./products"
import { listProductsByIds } from "./recent-products"

const listMock = listProducts as unknown as ReturnType<typeof vi.fn>

describe("listProductsByIds", () => {
  beforeEach(() => vi.resetAllMocks())

  it("asks for at most 12 ids and keeps their order", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `p${i}`)
    listMock.mockResolvedValue({
      response: { products: [{ id: "p1" }, { id: "p0" }] },
    })
    const result = await listProductsByIds(ids, "us")
    const args = listMock.mock.calls[0][0]
    expect(args.queryParams.id).toEqual(ids.slice(0, 12))
    expect(args.queryParams.limit).toBe(12)
    expect(result.map((p) => p.id)).toEqual(["p0", "p1"])
  })

  it("returns [] for no ids", async () => {
    expect(await listProductsByIds([], "us")).toEqual([])
    expect(listMock).not.toHaveBeenCalled()
  })
})
